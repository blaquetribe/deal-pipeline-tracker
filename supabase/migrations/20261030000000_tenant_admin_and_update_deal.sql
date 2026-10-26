-- Feature 01, slice 4: tenant creation, role administration with the escalation rules, the
-- append-only tenant trail, the last-owner invariant, and update_deal (SECURITY_STANDARDS "RBAC").

-- Tenant trail: who changed who can do what. Append-only for every role, like the deal ledger. ------------

create table public.tenant_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind text not null
    check (kind in ('tenant_created', 'role_granted', 'role_revoked', 'member_deactivated', 'ownership_transferred')),
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_email text not null,
  subject_user_id uuid references auth.users (id) on delete restrict,
  detail text,
  created_at timestamptz not null default now()
);
create index tenant_events_tenant_idx on public.tenant_events (tenant_id, seq);

alter table public.tenant_events enable row level security;
alter table public.tenant_events force row level security;
create policy tenant_events_select on public.tenant_events
  for select to authenticated
  using ((select app.has_permission(tenant_id, 'member.manage')) or (select app.has_permission(tenant_id, 'ledger.audit')));
revoke all on public.tenant_events from public, anon, authenticated, service_role;
grant select on public.tenant_events to authenticated;

create function app.tenant_events_before_insert() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if app.uid() is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;
  new.actor_id := app.uid();
  new.created_at := now();
  select u.email into new.actor_email from auth.users u where u.id = new.actor_id;
  return new;
end
$$;
revoke all on function app.tenant_events_before_insert() from public;
create trigger tenant_events_before_insert
  before insert on public.tenant_events
  for each row execute function app.tenant_events_before_insert();

create function app.tenant_events_deny_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'tenant_events is append-only';
end
$$;
revoke all on function app.tenant_events_deny_change() from public;
create trigger tenant_events_no_update_delete
  before update or delete on public.tenant_events
  for each row execute function app.tenant_events_deny_change();
create trigger tenant_events_no_truncate
  before truncate on public.tenant_events
  for each statement execute function app.tenant_events_deny_change();

-- Last owner: an invariant that binds every role, the superuser included. ----------------------------------

create function app.other_active_owner_exists(p_tenant uuid, p_except_membership uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id and r.key = 'owner' and r.tenant_id = mr.tenant_id
    join public.memberships m on m.id = mr.membership_id
    where mr.tenant_id = p_tenant and m.id <> p_except_membership and m.deactivated_at is null
  )
$$;
revoke all on function app.other_active_owner_exists(uuid, uuid) from public;

create function app.membership_roles_last_owner_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.roles r where r.id = old.role_id and r.key = 'owner')
     and not app.other_active_owner_exists(old.tenant_id, old.membership_id) then
    raise exception 'cannot remove the last owner' using errcode = 'DP422';
  end if;
  return old;
end
$$;
revoke all on function app.membership_roles_last_owner_guard() from public;
create trigger membership_roles_last_owner_guard
  before delete on public.membership_roles
  for each row execute function app.membership_roles_last_owner_guard();

create function app.memberships_last_owner_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if old.deactivated_at is null and new.deactivated_at is not null
     and exists (
       select 1 from public.membership_roles mr join public.roles r on r.id = mr.role_id
       where mr.membership_id = old.id and r.key = 'owner')
     and not app.other_active_owner_exists(old.tenant_id, old.id) then
    raise exception 'cannot remove the last owner' using errcode = 'DP422';
  end if;
  return new;
end
$$;
revoke all on function app.memberships_last_owner_guard() from public;
create trigger memberships_last_owner_guard
  before update of deactivated_at on public.memberships
  for each row execute function app.memberships_last_owner_guard();

-- Helpers ---------------------------------------------------------------------------------------------------------

-- A role is privileged when it can manage people or roles. Only someone who can manage roles (the
-- Owner) may hand it out, take it away, or deactivate a holder of it: no escalation by an Admin.
create function app.role_is_privileged(p_role uuid) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role and rp.permission in ('member.manage', 'role.manage')
  )
$$;
revoke all on function app.role_is_privileged(uuid) from public;

create function app.record_tenant_event(p_tenant uuid, p_kind text, p_subject uuid, p_detail text) returns void
  language sql security definer
  set search_path = ''
as $$
  insert into public.tenant_events (tenant_id, kind, subject_user_id, detail) values (p_tenant, p_kind, p_subject, p_detail)
$$;
revoke all on function app.record_tenant_event(uuid, text, uuid, text) from public;

-- Tenant creation: the verified creator becomes the Owner. ------------------------------------------------------------
-- Whether a user may create more than one tenant is an API policy (ADR 0001); the database requires only
-- a signed-in user whose email is verified.
create function public.create_tenant(p_name text) returns uuid
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
  if not exists (select 1 from auth.users u where u.id = v_uid and u.confirmed_at is not null) then
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
revoke all on function public.create_tenant(text) from public, anon, authenticated, service_role;
grant execute on function public.create_tenant(text) to authenticated;

-- Role administration -------------------------------------------------------------------------------------------------

create function public.grant_role(p_tenant uuid, p_user uuid, p_role_key text) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_membership uuid;
  v_role uuid;
begin
  if not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_user = app.uid() then
    raise exception 'cannot change your own roles' using errcode = '42501';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_user and m.deactivated_at is null;
  if v_membership is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  select r.id into v_role from public.roles r where r.tenant_id = p_tenant and r.key = p_role_key;
  if v_role is null then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if app.role_is_privileged(v_role) and not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'cannot grant a privileged role' using errcode = '42501';
  end if;

  insert into public.membership_roles (tenant_id, membership_id, role_id)
    values (p_tenant, v_membership, v_role)
    on conflict do nothing;
  perform app.record_tenant_event(p_tenant, 'role_granted', p_user, p_role_key);
end
$$;
revoke all on function public.grant_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.grant_role(uuid, uuid, text) to authenticated;

create function public.revoke_role(p_tenant uuid, p_user uuid, p_role_key text) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_membership uuid;
  v_role uuid;
begin
  if not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_user = app.uid() then
    raise exception 'cannot change your own roles' using errcode = '42501';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_user and m.deactivated_at is null;
  if v_membership is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  select r.id into v_role from public.roles r where r.tenant_id = p_tenant and r.key = p_role_key;
  if v_role is null then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if app.role_is_privileged(v_role) and not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'cannot grant a privileged role' using errcode = '42501';
  end if;

  delete from public.membership_roles where membership_id = v_membership and role_id = v_role;
  perform app.record_tenant_event(p_tenant, 'role_revoked', p_user, p_role_key);
end
$$;
revoke all on function public.revoke_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.revoke_role(uuid, uuid, text) to authenticated;

create function public.deactivate_member(p_tenant uuid, p_user uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_membership uuid;
begin
  if not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_user = app.uid() then
    raise exception 'cannot change your own roles' using errcode = '42501';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_user and m.deactivated_at is null;
  if v_membership is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.membership_roles mr where mr.membership_id = v_membership and app.role_is_privileged(mr.role_id))
     and not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'cannot grant a privileged role' using errcode = '42501';
  end if;

  update public.memberships set deactivated_at = now() where id = v_membership;
  perform app.record_tenant_event(p_tenant, 'member_deactivated', p_user, null);
end
$$;
revoke all on function public.deactivate_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.deactivate_member(uuid, uuid) to authenticated;

-- The new Owner is added before the old one is removed, so the tenant is never without an Owner.
create function public.transfer_ownership(p_tenant uuid, p_to_user uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_uid uuid := app.uid();
  v_owner_role uuid;
  v_from_membership uuid;
  v_to_membership uuid;
begin
  select r.id into v_owner_role from public.roles r where r.tenant_id = p_tenant and r.key = 'owner';
  select mr.membership_id into v_from_membership
    from public.membership_roles mr join public.memberships m on m.id = mr.membership_id
    where mr.tenant_id = p_tenant and mr.role_id = v_owner_role and m.user_id = v_uid and m.deactivated_at is null;
  if v_from_membership is null then
    raise exception 'only an owner can transfer ownership' using errcode = '42501';
  end if;
  if p_to_user = v_uid then
    raise exception 'already the owner' using errcode = '22023';
  end if;
  select m.id into v_to_membership from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_to_user and m.deactivated_at is null;
  if v_to_membership is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  insert into public.membership_roles (tenant_id, membership_id, role_id)
    values (p_tenant, v_to_membership, v_owner_role) on conflict do nothing;
  delete from public.membership_roles where membership_id = v_from_membership and role_id = v_owner_role;
  perform app.record_tenant_event(p_tenant, 'ownership_transferred', p_to_user, null);
end
$$;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- update_deal -------------------------------------------------------------------------------------------------------------

-- p_changes carries only the keys to change; anything outside the allow-list is refused, so the tenant,
-- stage, version and timestamps cannot be written from here. Amounts arrive as integer strings (E10).
create function public.update_deal(p_deal uuid, p_expected_version integer, p_changes jsonb) returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_key text;
  v_missing text;
  v_version integer;
  v_summary text;
  v_amount bigint;
begin
  select * into d from public.deals
    where id = p_deal and tenant_id in (select app.my_tenants())
    for update;
  if not found then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  if not app.has_permission(d.tenant_id, 'deal.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if d.archived_at is not null then
    raise exception 'deal is archived' using errcode = '55000';
  end if;
  if d.version <> p_expected_version then
    raise exception 'stale version' using errcode = 'DP409';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'no changes' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(p_changes) as k
    where k not in ('name', 'sector', 'amount', 'currency', 'expected_close_date', 'expected_close_time')
    order by k limit 1;
  if v_key is not null then
    raise exception 'unsupported field: %', v_key using errcode = '22023';
  end if;

  if p_changes ? 'amount' and jsonb_typeof(p_changes -> 'amount') <> 'null' then
    if jsonb_typeof(p_changes -> 'amount') <> 'string' or (p_changes ->> 'amount') !~ '^-?[0-9]{1,18}$' then
      raise exception 'invalid amount' using errcode = '22023';
    end if;
    v_amount := (p_changes ->> 'amount')::bigint;
  end if;

  select string_agg(
           c.key || ': ' || coalesce(to_jsonb(d) ->> c.key, '(none)') || ' -> ' || coalesce(c.value #>> '{}', '(none)'),
           ', ' order by c.key)
    into v_summary from jsonb_each(p_changes) as c;

  update public.deals set
    name = case when p_changes ? 'name' then p_changes ->> 'name' else name end,
    sector = case when p_changes ? 'sector' then p_changes ->> 'sector' else sector end,
    amount = case when p_changes ? 'amount' then v_amount else amount end,
    currency = case when p_changes ? 'currency' then p_changes ->> 'currency' else currency end,
    expected_close_date = case when p_changes ? 'expected_close_date' then (p_changes ->> 'expected_close_date')::date else expected_close_date end,
    expected_close_time = case when p_changes ? 'expected_close_time' then (p_changes ->> 'expected_close_time')::time else expected_close_time end,
    version = version + 1
  where id = d.id
  returning * into d;

  -- The deal must still hold every field its current stage requires.
  select string_agg(r.field, ', ' order by r.field) into v_missing
    from public.stage_requirements r
    where r.stage = d.stage and to_jsonb(d) ->> r.field is null;
  if v_missing is not null then
    raise exception 'missing required fields: %', v_missing using errcode = 'DP422';
  end if;

  v_version := d.version;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'field_change', 'Updated: ' || v_summary);
  return v_version;
end
$$;
revoke all on function public.update_deal(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_deal(uuid, integer, jsonb) to authenticated;
