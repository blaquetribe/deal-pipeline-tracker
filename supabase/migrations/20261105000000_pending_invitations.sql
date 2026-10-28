-- Feature 02: expose safe invitation metadata to tenant managers without exposing token hashes.
create function public.pending_invitations(p_tenant uuid)
  returns table (
    invitation_id uuid,
    invite_email text,
    role_key text,
    created_at timestamptz,
    expires_at timestamptz
  )
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  if not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.role_key, i.created_at, i.expires_at
    from public.invitations i
    where i.tenant_id = p_tenant
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at, i.id;
end
$$;

revoke all on function public.pending_invitations(uuid) from public, anon, authenticated, service_role, api_service;
grant execute on function public.pending_invitations(uuid) to authenticated;
