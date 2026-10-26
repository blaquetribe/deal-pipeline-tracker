-- create_tenant must check email_confirmed_at, not confirmed_at: confirmed_at is generated as
-- LEAST(email_confirmed_at, phone_confirmed_at) and so also becomes non-null for a phone-only
-- confirmation (GOTCHAS 100). Supersedes the check in 20261030000000; same signature and grants.
create or replace function public.create_tenant(p_name text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_uid uuid := app.uid();
  v_tenant uuid;
  v_membership uuid;
begin
  if v_uid is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = '42501';
  end if;

  insert into public.tenants (name) values (p_name) returning id into v_tenant;
  perform app.seed_system_roles(v_tenant);
  insert into public.memberships (tenant_id, user_id) values (v_tenant, v_uid) returning id into v_membership;
  insert into public.membership_roles (tenant_id, membership_id, role_id)
    select v_tenant, v_membership, r.id from public.roles r where r.tenant_id = v_tenant and r.key = 'owner';
  perform app.record_tenant_event(v_tenant, 'tenant_created', v_uid, p_name);
  return v_tenant;
end
$$;
