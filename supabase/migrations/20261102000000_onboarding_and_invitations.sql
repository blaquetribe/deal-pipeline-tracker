-- Feature 02, slice B: tenant settings, the server-driven onboarding state machine, create_organisation
-- (the only way a user creates a tenant), and invitations (docs/features/02-auth-onboarding/onboarding-flow.md).

-- Tenant settings ---------------------------------------------------------------------------------------------
alter table public.tenants
  add column timezone text not null default 'Africa/Johannesburg',
  add column default_currency text not null default 'ZAR' check (default_currency ~ '^[A-Z]{3}$'),
  add column closing_soon_days integer not null default 30 check (closing_soon_days between 1 and 365);

-- Tenant trail: new kinds, and an actor that can be set for flows that run without a user JWT
-- (accepting an invitation runs as api_service on behalf of the invitee, inside one definer function; an
-- explicit actor wins over any user identity already on the connection).
alter table public.tenant_events drop constraint tenant_events_kind_check;
alter table public.tenant_events add constraint tenant_events_kind_check
  check (kind in ('tenant_created', 'role_granted', 'role_revoked', 'member_deactivated', 'ownership_transferred',
                  'settings_changed', 'invitation_sent', 'invitation_revoked', 'invitation_accepted'));

create or replace function app.tenant_events_before_insert() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_actor uuid := coalesce(nullif(current_setting('app.actor', true), '')::uuid, app.uid());
begin
  if v_actor is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;
  new.actor_id := v_actor;
  new.created_at := now();
  select u.email into new.actor_email from auth.users u where u.id = v_actor;
  return new;
end
$$;

-- Users no longer create tenants directly: create_organisation is the one door.
revoke execute on function public.create_tenant(text) from authenticated;

-- Onboarding state machine ---------------------------------------------------------------------------------------
create table public.onboarding_steps (
  flow text not null check (flow in ('owner', 'invitee')),
  position integer not null,
  step text not null,
  required boolean not null,
  primary key (flow, step),
  unique (flow, position)
);
insert into public.onboarding_steps (flow, position, step, required) values
  ('owner', 1, 'profile', true),
  ('owner', 2, 'organisation', true),
  ('owner', 3, 'defaults', false),
  ('owner', 4, 'invite', false),
  ('owner', 5, 'done', true),
  ('invitee', 1, 'profile', true),
  ('invitee', 2, 'done', true);

create table public.onboarding_progress (
  user_id uuid primary key references auth.users (id) on delete restrict,
  flow text not null check (flow in ('owner', 'invitee')),
  current_step text not null,
  skipped_steps text[] not null default '{}',
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (flow, current_step) references public.onboarding_steps (flow, step)
);

alter table public.onboarding_steps enable row level security;
alter table public.onboarding_steps force row level security;
alter table public.onboarding_progress enable row level security;
alter table public.onboarding_progress force row level security;
create policy onboarding_steps_select on public.onboarding_steps for select to authenticated using (true);
create policy onboarding_progress_select_own on public.onboarding_progress
  for select to authenticated using (user_id = (select app.uid()));
revoke all on public.onboarding_steps, public.onboarding_progress from public, anon, authenticated, service_role, api_service;
grant select on public.onboarding_steps, public.onboarding_progress to authenticated;

-- Moves a locked progress row to the step after its current one; the last step completes the flow.
create function app.onboarding_move_next(p_user uuid) returns text
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_next text;
begin
  select s2.step into v_next
    from public.onboarding_progress p
    join public.onboarding_steps s1 on s1.flow = p.flow and s1.step = p.current_step
    join public.onboarding_steps s2 on s2.flow = p.flow and s2.position = s1.position + 1
    where p.user_id = p_user;
  update public.onboarding_progress
    set current_step = v_next, updated_at = now(),
        completed_at = case when v_next = 'done' then now() end
    where user_id = p_user;
  return v_next;
end
$$;
revoke all on function app.onboarding_move_next(uuid) from public;

create function public.onboarding_state() returns table (flow text, current_step text, completed boolean, skipped text[])
  language sql stable security definer
  set search_path = ''
as $$
  select p.flow, p.current_step, p.completed_at is not null, p.skipped_steps
  from public.onboarding_progress p where p.user_id = (select app.uid())
$$;

create function public.onboarding_advance(p_step text) returns text
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_uid uuid := app.uid();
  v_progress public.onboarding_progress;
begin
  select * into v_progress from public.onboarding_progress where user_id = v_uid for update;
  if not found or v_progress.completed_at is not null or v_progress.current_step <> p_step then
    raise exception 'not at this step' using errcode = 'DP422';
  end if;
  if p_step = 'profile' and not exists (select 1 from public.profiles pr where pr.user_id = v_uid) then
    raise exception 'profile required' using errcode = 'DP422';
  end if;
  if p_step = 'organisation' then
    raise exception 'use create_organisation' using errcode = 'DP422';
  end if;
  return app.onboarding_move_next(v_uid);
end
$$;

create function public.onboarding_skip(p_step text) returns text
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_uid uuid := app.uid();
  v_progress public.onboarding_progress;
begin
  select * into v_progress from public.onboarding_progress where user_id = v_uid for update;
  if not found or v_progress.completed_at is not null or v_progress.current_step <> p_step then
    raise exception 'not at this step' using errcode = 'DP422';
  end if;
  if (select s.required from public.onboarding_steps s where s.flow = v_progress.flow and s.step = p_step) then
    raise exception 'step is required' using errcode = 'DP422';
  end if;
  update public.onboarding_progress set skipped_steps = skipped_steps || p_step where user_id = v_uid;
  return app.onboarding_move_next(v_uid);
end
$$;

-- Organisation ------------------------------------------------------------------------------------------------------
create function public.create_organisation(
  p_name text,
  p_timezone text default 'Africa/Johannesburg',
  p_currency text default 'ZAR'
) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_uid uuid := app.uid();
  v_tenant uuid;
begin
  if v_uid is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email not verified' using errcode = '42501';
  end if;
  perform 1 from public.onboarding_progress p
    where p.user_id = v_uid and p.flow = 'owner' and p.current_step = 'organisation' and p.completed_at is null
    for update;
  if not found then
    raise exception 'not at this step' using errcode = 'DP422';
  end if;
  -- Once per user: the append-only trail remembers, even if the progress record were rewound.
  if exists (select 1 from public.tenant_events e where e.kind = 'tenant_created' and e.actor_id = v_uid) then
    raise exception 'organisation already created' using errcode = 'DP422';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;

  v_tenant := public.create_tenant(p_name);
  update public.tenants set timezone = p_timezone, default_currency = p_currency where id = v_tenant;
  perform app.onboarding_move_next(v_uid);
  return v_tenant;
end
$$;

create function public.update_tenant_settings(p_tenant uuid, p_timezone text, p_currency text, p_closing_soon_days integer)
  returns void
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  update public.tenants
    set timezone = p_timezone, default_currency = p_currency, closing_soon_days = p_closing_soon_days
    where id = p_tenant;
  perform app.record_tenant_event(p_tenant, 'settings_changed', null,
    p_timezone || ' ' || p_currency || ' ' || p_closing_soon_days);
end
$$;

-- Verifying the email starts the owner flow (a user who is only ever invited never gets one).
create or replace function public.token_consume(p_purpose text, p_token_hash text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_purpose not in ('verify_email', 'reset_password') then
    raise exception 'unknown purpose' using errcode = '22023';
  end if;

  update public.email_tokens t set consumed_at = now()
    from auth.users u
    where t.token_hash = p_token_hash and t.purpose = p_purpose
      and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
      and u.id = t.user_id and u.email = t.email
    returning t.user_id into v_user;
  if v_user is null then
    raise exception 'invalid token' using errcode = 'DP401';
  end if;

  if p_purpose = 'verify_email' then
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_user;
    insert into public.onboarding_progress (user_id, flow, current_step) values (v_user, 'owner', 'profile')
      on conflict (user_id) do nothing;
  end if;
  return v_user;
end
$$;

-- Invitations -----------------------------------------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role_key text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete restrict,
  revoked_at timestamptz
);
create unique index invitations_one_pending_idx on public.invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_tenant_idx on public.invitations (tenant_id, created_at);

alter table public.invitations enable row level security;
alter table public.invitations force row level security;
create policy invitations_select on public.invitations
  for select to authenticated using ((select app.has_permission(tenant_id, 'member.manage')));
revoke all on public.invitations from public, anon, authenticated, service_role, api_service;
-- Everything except the token hash.
grant select (id, tenant_id, email, role_key, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.invitations to authenticated;

create function public.invite_member(p_tenant uuid, p_email text, p_role_key text, p_token_hash text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_role uuid;
  v_id uuid;
begin
  if not app.has_permission(p_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  select r.id into v_role from public.roles r where r.tenant_id = p_tenant and r.key = p_role_key;
  if v_role is null then
    raise exception 'role not found' using errcode = 'P0002';
  end if;
  if app.role_is_privileged(v_role) and not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'cannot grant a privileged role' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.tenant_id = p_tenant and m.deactivated_at is null and lower(u.email) = v_email) then
    raise exception 'already a member' using errcode = '22023';
  end if;
  if (select count(*) from public.invitations i
        where i.tenant_id = p_tenant and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) >= 50 then
    raise exception 'invitation limit reached' using errcode = 'DP422';
  end if;

  update public.invitations set revoked_at = now()
    where tenant_id = p_tenant and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.invitations (tenant_id, email, role_key, token_hash, invited_by, expires_at)
    values (p_tenant, v_email, p_role_key, p_token_hash, app.uid(), now() + interval '7 days')
    returning id into v_id;
  perform app.record_tenant_event(p_tenant, 'invitation_sent', null, v_email || ' as ' || p_role_key);
  return v_id;
end
$$;

create function public.revoke_invitation(p_invitation uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select i.tenant_id into v_tenant from public.invitations i where i.id = p_invitation;
  if v_tenant is null or not app.has_permission(v_tenant, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now()
    where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  perform app.record_tenant_event(v_tenant, 'invitation_revoked', null, null);
end
$$;

-- The landing page shows who is inviting you to what before you commit to anything. The organisation
-- name is self-declared by whoever created it, and the page says so (SECURITY_STANDARDS, tokens).
create function public.invitation_preview(p_token_hash text)
  returns table (tenant_name text, inviter_email text, role_name text, email text)
  language plpgsql stable security definer
  set search_path = ''
as $$
begin
  return query
    select t.name, u.email::text, r.name, i.email
    from public.invitations i
    join public.tenants t on t.id = i.tenant_id
    join auth.users u on u.id = i.invited_by
    join public.roles r on r.tenant_id = i.tenant_id and r.key = i.role_key
    where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  if not found then
    raise exception 'invalid token' using errcode = 'DP401';
  end if;
end
$$;

-- One atomic step: consume the invitation, verify the address (the link proves possession), create or
-- reactivate the membership, grant the role (the separation-of-duties trigger still applies and would
-- roll everything back), start the short invitee flow, and record the invitee as the actor.
create function public.invitation_accept(p_token_hash text, p_user uuid) returns uuid
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
  perform set_config('app.actor', '', true);  -- scoped to this function, not the rest of the transaction
  return v_invitation.tenant_id;
end
$$;

-- Grants ---------------------------------------------------------------------------------------------------------------------
revoke all on function
  public.onboarding_state(), public.onboarding_advance(text), public.onboarding_skip(text),
  public.create_organisation(text, text, text), public.update_tenant_settings(uuid, text, text, integer),
  public.invite_member(uuid, text, text, text), public.revoke_invitation(uuid),
  public.invitation_preview(text), public.invitation_accept(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.onboarding_state(), public.onboarding_advance(text), public.onboarding_skip(text),
  public.create_organisation(text, text, text), public.update_tenant_settings(uuid, text, text, integer),
  public.invite_member(uuid, text, text, text), public.revoke_invitation(uuid)
  to authenticated;
grant execute on function public.invitation_preview(text), public.invitation_accept(text, uuid) to api_service;
