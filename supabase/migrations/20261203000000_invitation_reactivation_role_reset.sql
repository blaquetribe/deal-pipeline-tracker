-- Reactivating a deactivated membership must not revive roles that are absent from the new invitation.
-- Keep invitation acceptance atomic; old role removal, membership reactivation, new role grant, and audit
-- event either commit together or roll back together.
create or replace function public.invitation_accept(p_token_hash text, p_user uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_invitation public.invitations;
  v_role uuid;
  v_membership uuid;
begin
  select * into v_invitation from public.invitations i
    where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update;
  if not found
     or not exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = v_invitation.email) then
    raise exception 'invalid token' using errcode = 'DP401';
  end if;
  select r.id into v_role from public.roles r where r.tenant_id = v_invitation.tenant_id and r.key = v_invitation.role_key;
  if v_role is null then
    raise exception 'role not found' using errcode = 'P0002';
  end if;

  perform set_config('app.actor', p_user::text, true);
  delete from public.membership_roles mr using public.memberships m
    where m.tenant_id = v_invitation.tenant_id and m.user_id = p_user and m.deactivated_at is not null
      and mr.tenant_id = m.tenant_id and mr.membership_id = m.id;
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = p_user;
  insert into public.memberships (tenant_id, user_id) values (v_invitation.tenant_id, p_user)
    on conflict (tenant_id, user_id) do update set deactivated_at = null
    returning id into v_membership;
  insert into public.membership_roles (tenant_id, membership_id, role_id)
    values (v_invitation.tenant_id, v_membership, v_role) on conflict do nothing;
  insert into public.onboarding_progress (user_id, flow, current_step) values (p_user, 'invitee', 'profile')
    on conflict (user_id) do nothing;
  update public.invitations set accepted_at = now(), accepted_by = p_user where id = v_invitation.id;
  perform app.record_tenant_event(v_invitation.tenant_id, 'invitation_accepted', p_user, v_invitation.role_key);
  perform set_config('app.actor', '', true);
  return v_invitation.tenant_id;
end
$$;

revoke all on function public.invitation_accept(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.invitation_accept(text, uuid) to api_service;
