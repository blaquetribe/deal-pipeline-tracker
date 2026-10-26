-- Feature 01, slice 1: tenancy, deals, and the append-only deal_events ledger (ADR 0002).
-- Runs as `postgres` inside the runner's single transaction. Default deny: nothing is reachable by
-- anon, authenticated or service_role unless this file grants it.

-- Private schema for helpers. PostgREST exposes only `public`, so nothing here is an API route.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- New objects created by this role in `public` start with no grants for the API roles.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;

-- The caller's user id. PostgREST runs with legacy GUCs off, so it sets only request.jwt.claims;
-- the image's auth.uid() reads only request.jwt.claim.sub and would return null through the API.
create function app.uid() returns uuid
  language sql stable
  set search_path = ''
as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )::uuid
$$;
revoke all on function app.uid() from public;
grant execute on function app.uid() to authenticated;

-- Tables ------------------------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  unique (tenant_id, user_id)
);
create index memberships_user_tenant_idx on public.memberships (user_id, tenant_id);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  stage text not null default 'sourcing'
    check (stage in ('sourcing', 'screening', 'due_diligence', 'ic_review', 'signed', 'closed', 'passed')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id)
);
create index deals_tenant_idx on public.deals (tenant_id, stage);

create table public.deal_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null,
  deal_id uuid not null,
  kind text not null
    check (kind in ('note', 'field_change', 'stage_change', 'decision', 'approval_decision', 'correction')),
  body text not null check (char_length(body) between 1 and 10000),
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_email text not null,
  actor_name text,
  created_at timestamptz not null default now(),
  amends_event_id uuid,
  prev_hash text,
  hash text not null,
  unique (tenant_id, deal_id, id),
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete restrict,
  foreign key (tenant_id, deal_id, amends_event_id) references public.deal_events (tenant_id, deal_id, id) on delete restrict
);
create index deal_events_deal_idx on public.deal_events (tenant_id, deal_id, seq);

-- Row level security: enabled and forced, readable only by members of the row's tenant. ---------------

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.deals enable row level security;
alter table public.deals force row level security;
alter table public.deal_events enable row level security;
alter table public.deal_events force row level security;

-- Membership is read from the table, never from a claim. Users see their own membership rows only;
-- the tenant-scoped directory of colleagues comes later through a function, which also keeps this
-- policy free of self-reference (no recursion).
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = (select app.uid()));

create function app.my_tenants() returns setof uuid
  language sql stable
  set search_path = ''
as $$
  select m.tenant_id from public.memberships m
  where m.user_id = (select app.uid()) and m.deactivated_at is null
$$;
revoke all on function app.my_tenants() from public;
grant execute on function app.my_tenants() to authenticated;

create policy tenants_select_member on public.tenants
  for select to authenticated
  using (id in (select app.my_tenants()));
create policy deals_select_member on public.deals
  for select to authenticated
  using (tenant_id in (select app.my_tenants()));
create policy deal_events_select_member on public.deal_events
  for select to authenticated
  using (tenant_id in (select app.my_tenants()));

-- Grants: read only. Every write goes through a function. -------------------------------------------------

revoke all on public.tenants, public.memberships, public.deals, public.deal_events
  from public, anon, authenticated, service_role;
grant select on public.tenants, public.memberships, public.deals, public.deal_events to authenticated;

-- Ledger ----------------------------------------------------------------------------------------------------

-- One definition of what the hash covers, used by the insert trigger and by verify_ledger.
create function app.event_hash(e public.deal_events) returns text
  language sql immutable
  set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          e.prev_hash, e.id, e.tenant_id, e.deal_id, e.kind, e.body, e.actor_id, e.actor_email, e.actor_name,
          to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), e.amends_event_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;
revoke all on function app.event_hash(public.deal_events) from public;
grant execute on function app.event_hash(public.deal_events) to authenticated;

-- Attribution, time and the hash chain are set here, whatever the caller supplied. SECURITY DEFINER
-- because it must read auth.users (actor snapshot) and every earlier event of the deal regardless
-- of the caller's own visibility; it locks the deal row so concurrent inserts chain in order.
create function app.deal_events_before_insert() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_actor uuid := app.uid();
  v_prev text;
begin
  if v_actor is null then
    raise exception 'no authenticated user' using errcode = '42501';
  end if;

  perform 1 from public.deals d where d.id = new.deal_id and d.tenant_id = new.tenant_id for update;

  select u.email, nullif(u.raw_user_meta_data ->> 'full_name', '')
    into new.actor_email, new.actor_name
    from auth.users u where u.id = v_actor;
  if new.actor_email is null then
    raise exception 'unknown actor' using errcode = '42501';
  end if;

  select e.hash into v_prev from public.deal_events e
    where e.deal_id = new.deal_id order by e.seq desc limit 1;

  new.actor_id := v_actor;
  new.created_at := now();
  new.prev_hash := v_prev;
  new.hash := app.event_hash(new);
  return new;
end
$$;
revoke all on function app.deal_events_before_insert() from public;

create trigger deal_events_before_insert
  before insert on public.deal_events
  for each row execute function app.deal_events_before_insert();

create function app.deal_events_deny_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'deal_events is append-only';
end
$$;
revoke all on function app.deal_events_deny_change() from public;

create trigger deal_events_no_update_delete
  before update or delete on public.deal_events
  for each row execute function app.deal_events_deny_change();
create trigger deal_events_no_truncate
  before truncate on public.deal_events
  for each statement execute function app.deal_events_deny_change();

-- Write path: a member posts a note to a deal of their tenant. A deal in another tenant and a deal
-- that does not exist look the same. Slice 2 adds the permission check; membership alone is not
-- enough for default deny.
create function public.post_event(p_deal uuid, p_kind text, p_body text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  if p_kind <> 'note' then
    raise exception 'unsupported event kind' using errcode = '22023';
  end if;

  select d.tenant_id into v_tenant from public.deals d
    where d.id = p_deal and d.tenant_id in (select app.my_tenants());
  if v_tenant is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (v_tenant, p_deal, p_kind, p_body)
    returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.post_event(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.post_event(uuid, text, text) to authenticated;

-- Recomputes the chain for one deal. SECURITY INVOKER: a caller can only verify what RLS lets them see.
create function public.verify_ledger(p_deal uuid) returns boolean
  language sql stable
  set search_path = ''
as $$
  select coalesce(bool_and(
    c.prev_hash is not distinct from c.expected_prev and c.hash = app.event_hash(c.e)
  ), true)
  from (
    select e, e.prev_hash, e.hash, lag(e.hash) over (order by e.seq) as expected_prev
    from public.deal_events e where e.deal_id = p_deal
  ) c
$$;
revoke all on function public.verify_ledger(uuid) from public, anon, authenticated, service_role;
grant execute on function public.verify_ledger(uuid) to authenticated;
