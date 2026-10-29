-- Feature 04: owner-managed custom role definitions with database-enforced SoD and audit history.

alter table public.tenant_events drop constraint tenant_events_kind_check;
alter table public.tenant_events add constraint tenant_events_kind_check
  check (kind in ('tenant_created', 'role_granted', 'role_revoked', 'member_deactivated', 'ownership_transferred',
                  'settings_changed', 'invitation_sent', 'invitation_revoked', 'invitation_accepted',
                  'approval_absence_set', 'approval_absence_cancelled',
                  'approval_delegation_set', 'approval_delegation_cancelled',
                  'role_created', 'role_updated'));

-- The invoker can see only their own tenant's catalog. Expose the permission catalog, roles,
-- permission assignments, and whether this caller may edit them through one stable API shape.
create function public.tenant_roles_catalog(p_tenant uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  if p_tenant is null or not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = app.uid() and m.deactivated_at is null
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'canManageRoles', app.has_permission(p_tenant, 'role.manage'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'key', r.key,
        'name', r.name,
        'isSystem', r.is_system,
        'permissions', coalesce((
          select jsonb_agg(rp.permission order by rp.permission)
          from public.role_permissions rp
          where rp.tenant_id = r.tenant_id and rp.role_id = r.id
        ), '[]'::jsonb)
      ) order by r.is_system desc, r.name)
      from public.roles r where r.tenant_id = p_tenant
    ), '[]'::jsonb),
    'permissionCatalog', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'description', p.description) order by p.key)
      from public.permissions p
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.tenant_roles_catalog(uuid) from public, anon, authenticated, service_role;
grant execute on function public.tenant_roles_catalog(uuid) to authenticated;

-- Creating and editing a role is atomic: replacement permission sets are validated against both
-- role-level conflicts and every member who currently holds the role. The UI never gets table writes.
create function public.save_custom_role(
  p_tenant uuid,
  p_role uuid,
  p_name text,
  p_permissions text[]
) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_id uuid;
  v_key text;
  v_name text := btrim(coalesce(p_name, ''));
  v_saved_permissions text[];
begin
  if not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'role name must be between 1 and 100 characters' using errcode = '22023';
  end if;
  if p_permissions is null or cardinality(p_permissions) not between 1 and 64 then
    raise exception 'custom role needs at least one permission' using errcode = '22023';
  end if;
  if cardinality(p_permissions) <> (
    select count(distinct requested.permission) from unnest(p_permissions) as requested(permission)
  ) then
    raise exception 'duplicate permissions' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_permissions) as requested(permission)
    left join public.permissions p on p.key = requested.permission
    where p.key is null
  ) then
    raise exception 'unknown permission' using errcode = '22023';
  end if;
  if app.perm_set_conflicts(p_permissions) then
    raise exception 'separation of duties conflict' using errcode = '23514';
  end if;

  if p_role is null then
    v_key := 'custom_' || translate(replace(pg_catalog.gen_random_uuid()::text, '-', ''), '0123456789', 'abcdefghij');
    insert into public.roles (tenant_id, key, name) values (p_tenant, v_key, v_name)
      returning id into v_id;
  else
    select r.key into v_key from public.roles r
      where r.id = p_role and r.tenant_id = p_tenant for update;
    if not found then
      raise exception 'role not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.roles r where r.id = p_role and r.is_system) then
      raise exception 'system roles are immutable' using errcode = '55000';
    end if;
    v_id := p_role;
    update public.roles set name = v_name where id = v_id and tenant_id = p_tenant;
    delete from public.role_permissions where tenant_id = p_tenant and role_id = v_id;
  end if;

  insert into public.role_permissions (tenant_id, role_id, permission)
    select p_tenant, v_id, requested.permission
    from unnest(p_permissions) as requested(permission)
    order by requested.permission;

  select array_agg(rp.permission order by rp.permission) into v_saved_permissions
  from public.role_permissions rp where rp.tenant_id = p_tenant and rp.role_id = v_id;

  perform app.record_tenant_event(
    p_tenant,
    case when p_role is null then 'role_created' else 'role_updated' end,
    null,
    v_key || ': ' || v_name || ' permissions=' || array_to_string(v_saved_permissions, ',')
  );
  return v_id;
end
$$;

revoke all on function public.save_custom_role(uuid, uuid, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.save_custom_role(uuid, uuid, text, text[]) to authenticated;
