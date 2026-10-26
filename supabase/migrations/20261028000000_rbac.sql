-- Feature 01, slice 2: permission-based RBAC (SECURITY_STANDARDS "RBAC and separation of duties").
-- Roles are per-tenant sets of catalogue permissions. System roles are immutable. Static separation
-- of duties is data (permission_conflicts) checked in one function. Reads and writes are default deny:
-- membership alone opens nothing, a permission does.

-- Global reference data (no tenant_id: the same catalogue for every tenant, never written by users) ---

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text not null
);

insert into public.permissions (key, description) values
  ('deal.view', 'See deals and their ledger'),
  ('deal.create', 'Create deals'),
  ('deal.edit', 'Edit deal fields and move stages'),
  ('deal.note', 'Post notes to a deal'),
  ('deal.request_approval', 'Submit a deal for approval'),
  ('approval.decide', 'Approve or reject an approval request'),
  ('member.manage', 'Invite, change and deactivate members'),
  ('role.manage', 'Create and edit custom roles'),
  ('ledger.audit', 'Verify the ledger and read audit views');

-- Pairs one person must never hold together (static separation of duties).
create table public.permission_conflicts (
  a text not null references public.permissions (key),
  b text not null references public.permissions (key),
  reason text not null,
  primary key (a, b),
  check (a < b)
);
insert into public.permission_conflicts (a, b, reason) values
  ('approval.decide', 'deal.request_approval', 'whoever requests an approval must not decide it'),
  ('approval.decide', 'member.manage', 'whoever manages people must not decide approvals'),
  ('approval.decide', 'role.manage', 'whoever manages roles must not decide approvals');

-- Per-tenant roles -----------------------------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  key text not null check (key ~ '^[a-z_]+$'),
  name text not null check (char_length(name) between 1 and 100),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table public.role_permissions (
  tenant_id uuid not null,
  role_id uuid not null,
  permission text not null references public.permissions (key),
  primary key (role_id, permission),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete restrict
);
create index role_permissions_tenant_idx on public.role_permissions (tenant_id, role_id);

alter table public.memberships add constraint memberships_tenant_id_id_key unique (tenant_id, id);

create table public.membership_roles (
  tenant_id uuid not null,
  membership_id uuid not null,
  role_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete restrict
);
create index membership_roles_tenant_idx on public.membership_roles (tenant_id, role_id);

-- Authorization helpers ---------------------------------------------------------------------------------------

-- True when any pair in the set is a registered conflict.
create function app.perm_set_conflicts(p_perms text[]) returns boolean
  language sql stable
  set search_path = ''
as $$
  select exists (
    select 1 from public.permission_conflicts c where c.a = any (p_perms) and c.b = any (p_perms)
  )
$$;
revoke all on function app.perm_set_conflicts(text[]) from public;

-- The single permission check, reused by policies and functions. SECURITY DEFINER so it can read the
-- RBAC tables whatever the caller may see, but it only ever answers about the caller (app.uid()).
-- Fails closed: no user, no active membership, no role or an unknown permission all give false.
create function app.has_permission(p_tenant uuid, p_permission text) returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce((
    select true
    from public.memberships m
    join public.membership_roles mr on mr.membership_id = m.id and mr.tenant_id = m.tenant_id
    join public.role_permissions rp on rp.role_id = mr.role_id and rp.tenant_id = mr.tenant_id
    where m.user_id = (select app.uid())
      and m.tenant_id = p_tenant
      and m.deactivated_at is null
      and rp.permission = p_permission
    limit 1
  ), false)
$$;
revoke all on function app.has_permission(uuid, text) from public;
grant execute on function app.has_permission(uuid, text) to authenticated;

-- Separation of duties and immutability, as triggers (they bind every role, including the owner) ----

create function app.role_permissions_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_role uuid := coalesce(new.role_id, old.role_id);
begin
  if (select r.is_system from public.roles r where r.id = v_role) then
    raise exception 'system roles are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if app.perm_set_conflicts(
       array(select rp.permission from public.role_permissions rp where rp.role_id = new.role_id) || new.permission) then
    raise exception 'separation of duties conflict' using errcode = '23514';
  end if;

  -- Everyone who already holds this role would gain the permission too.
  if exists (
    select 1 from public.membership_roles holder
    where holder.role_id = new.role_id
      and app.perm_set_conflicts(
        array(
          select rp.permission from public.membership_roles mr
          join public.role_permissions rp on rp.role_id = mr.role_id and rp.tenant_id = mr.tenant_id
          where mr.membership_id = holder.membership_id
        ) || new.permission)
  ) then
    raise exception 'separation of duties conflict' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.role_permissions_guard() from public;
create trigger role_permissions_guard
  before insert or update or delete on public.role_permissions
  for each row execute function app.role_permissions_guard();

create function app.roles_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.is_system then
    raise exception 'system roles are immutable';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end
$$;
revoke all on function app.roles_guard() from public;
create trigger roles_guard
  before update or delete on public.roles
  for each row execute function app.roles_guard();

create function app.membership_roles_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if app.perm_set_conflicts(
       array(
         select rp.permission from public.membership_roles mr
         join public.role_permissions rp on rp.role_id = mr.role_id and rp.tenant_id = mr.tenant_id
         where mr.membership_id = new.membership_id
       ) || array(select rp.permission from public.role_permissions rp where rp.role_id = new.role_id)) then
    raise exception 'separation of duties conflict' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function app.membership_roles_guard() from public;
create trigger membership_roles_guard
  before insert on public.membership_roles
  for each row execute function app.membership_roles_guard();

-- System roles ----------------------------------------------------------------------------------------------------

-- Called when a tenant is created (feature 02) and by tests. Not callable by users. Roles are created
-- as ordinary rows, filled, and only then flagged is_system, which is the one change the guards allow.
create function app.seed_system_roles(p_tenant uuid) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  insert into public.roles (tenant_id, key, name) values
    (p_tenant, 'owner', 'Owner'),
    (p_tenant, 'admin', 'Admin'),
    (p_tenant, 'deal_member', 'Deal Team Member'),
    (p_tenant, 'deal_lead', 'Deal Lead'),
    (p_tenant, 'ic_member', 'IC Member'),
    (p_tenant, 'observer_compliance', 'Observer / Compliance');

  insert into public.role_permissions (tenant_id, role_id, permission)
  select r.tenant_id, r.id, v.permission
  from (values
    ('owner', 'deal.view'), ('owner', 'deal.create'), ('owner', 'deal.edit'), ('owner', 'deal.note'),
    ('owner', 'member.manage'), ('owner', 'role.manage'), ('owner', 'ledger.audit'),
    ('admin', 'deal.view'), ('admin', 'member.manage'), ('admin', 'ledger.audit'),
    ('deal_member', 'deal.view'), ('deal_member', 'deal.edit'), ('deal_member', 'deal.note'),
    ('deal_lead', 'deal.view'), ('deal_lead', 'deal.create'), ('deal_lead', 'deal.edit'), ('deal_lead', 'deal.note'),
    ('deal_lead', 'deal.request_approval'),
    ('ic_member', 'deal.view'), ('ic_member', 'deal.note'), ('ic_member', 'approval.decide'),
    ('observer_compliance', 'deal.view'), ('observer_compliance', 'ledger.audit')
  ) as v(role_key, permission)
  join public.roles r on r.tenant_id = p_tenant and r.key = v.role_key;

  update public.roles set is_system = true where tenant_id = p_tenant and key in
    ('owner', 'admin', 'deal_member', 'deal_lead', 'ic_member', 'observer_compliance');
end
$$;
revoke all on function app.seed_system_roles(uuid) from public;

-- Row level security ----------------------------------------------------------------------------------------------

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
alter table public.permission_conflicts enable row level security;
alter table public.permission_conflicts force row level security;
alter table public.roles enable row level security;
alter table public.roles force row level security;
alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
alter table public.membership_roles enable row level security;
alter table public.membership_roles force row level security;

create policy permissions_select on public.permissions for select to authenticated using (true);
create policy permission_conflicts_select on public.permission_conflicts for select to authenticated using (true);
create policy roles_select_member on public.roles
  for select to authenticated using (tenant_id in (select app.my_tenants()));
create policy role_permissions_select_member on public.role_permissions
  for select to authenticated using (tenant_id in (select app.my_tenants()));
create policy membership_roles_select_member on public.membership_roles
  for select to authenticated using (tenant_id in (select app.my_tenants()));

revoke all on public.permissions, public.permission_conflicts, public.roles, public.role_permissions, public.membership_roles
  from public, anon, authenticated, service_role;
grant select on public.permissions, public.permission_conflicts, public.roles, public.role_permissions, public.membership_roles
  to authenticated;

-- Tighten slice 1: reading deals and the ledger needs deal.view, not just membership. -----------------------------------

drop policy deals_select_member on public.deals;
create policy deals_select_viewer on public.deals
  for select to authenticated using ((select app.has_permission(tenant_id, 'deal.view')));
drop policy deal_events_select_member on public.deal_events;
create policy deal_events_select_viewer on public.deal_events
  for select to authenticated using ((select app.has_permission(tenant_id, 'deal.view')));

-- post_event now requires deal.note. A deal outside the caller's tenants still looks absent.
create or replace function public.post_event(p_deal uuid, p_kind text, p_body text) returns uuid
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
  if not app.has_permission(v_tenant, 'deal.note') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (v_tenant, p_deal, p_kind, p_body)
    returning id into v_id;
  return v_id;
end
$$;
