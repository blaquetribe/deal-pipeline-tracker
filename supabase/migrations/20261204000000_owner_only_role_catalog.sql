-- Full role definitions and permission sets are an Owner-only administration surface.
create or replace function public.tenant_roles_catalog(p_tenant uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  if p_tenant is null or not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'canManageRoles', true,
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

create function public.tenant_invitable_roles(p_tenant uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_can_manage_roles boolean := app.has_permission(p_tenant, 'role.manage');
begin
  if p_tenant is null or not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'canManageRoles', v_can_manage_roles,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name)
                       order by r.is_system desc, r.name)
      from public.roles r
      where r.tenant_id = p_tenant
        and (v_can_manage_roles or r.key <> 'owner')
        and (
          v_can_manage_roles
          or not exists (
            select 1 from public.role_permissions rp
            where rp.tenant_id = r.tenant_id
              and rp.role_id = r.id
              and rp.permission in ('member.manage', 'role.manage')
          )
        )
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.tenant_roles_catalog(uuid) from public, anon, authenticated, service_role;
grant execute on function public.tenant_roles_catalog(uuid) to authenticated;
revoke all on function public.tenant_invitable_roles(uuid) from public, anon, authenticated, service_role;
grant execute on function public.tenant_invitable_roles(uuid) to authenticated;
