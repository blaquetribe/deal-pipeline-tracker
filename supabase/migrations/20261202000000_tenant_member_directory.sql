-- Return tenant-member identity and role summaries only to active member managers.
-- The API invokes this with the caller JWT; no browser or API service-role table access is needed.
create function public.tenant_members(p_tenant uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  if p_tenant is null or not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'email', u.email,
        'fullName', nullif(u.raw_user_meta_data ->> 'full_name', ''),
        'deactivatedAt', m.deactivated_at,
        'roles', coalesce((
          select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'isSystem', r.is_system)
                           order by r.name, r.key)
          from public.membership_roles mr
          join public.roles r on r.id = mr.role_id and r.tenant_id = mr.tenant_id
          where mr.tenant_id = m.tenant_id and mr.membership_id = m.id
        ), '[]'::jsonb)
      ) order by (m.deactivated_at is not null), lower(u.email), m.user_id)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.tenant_id = p_tenant
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.tenant_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.tenant_members(uuid) to authenticated;
