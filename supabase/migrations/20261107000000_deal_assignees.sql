-- Feature 03, slice 1: record deal responsibility without changing tenant-level visibility.

create table public.deal_assignees (
  tenant_id uuid not null,
  deal_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('owner', 'lead', 'member')),
  assigned_at timestamptz not null default now(),
  primary key (tenant_id, deal_id, user_id),
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete restrict,
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete restrict
);
create unique index deal_assignees_one_owner_idx on public.deal_assignees (tenant_id, deal_id)
  where role = 'owner';
create unique index deal_assignees_one_lead_idx on public.deal_assignees (tenant_id, deal_id)
  where role = 'lead';
create index deal_assignees_user_idx on public.deal_assignees (tenant_id, user_id, deal_id);

alter table public.deal_assignees enable row level security;
alter table public.deal_assignees force row level security;
create policy deal_assignees_select on public.deal_assignees
  for select to authenticated using ((select app.has_permission(tenant_id, 'deal.view')));
revoke all on public.deal_assignees from public, anon, authenticated, service_role;
grant select on public.deal_assignees to authenticated;

-- Assignment changes use the deal editor permission. The tenant is derived from the locked deal,
-- and each assigned user must be an active member of that same tenant. Assignment never grants access.
create function public.set_deal_assignees(p_deal uuid, p_expected_version integer, p_assignments jsonb)
  returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_old jsonb;
  v_new jsonb;
  v_version integer;
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
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array'
     or jsonb_array_length(p_assignments) > 50 then
    raise exception 'invalid assignments' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'user_id') <> 'string'
       or (item ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(item -> 'role') <> 'string'
       or item ->> 'role' not in ('owner', 'lead', 'member')
  ) then
    raise exception 'invalid assignment role or user' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    cross join lateral jsonb_object_keys(item) key
    where key not in ('user_id', 'role')
  ) then
    raise exception 'unsupported assignment field' using errcode = '22023';
  end if;
  if exists (
    select item ->> 'user_id' from jsonb_array_elements(p_assignments) item
    group by item ->> 'user_id' having count(*) > 1
  ) then
    raise exception 'a user can have only one assignment role per deal' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_assignments) item
    where not exists (
      select 1 from public.memberships m
      where m.tenant_id = d.tenant_id
        and m.user_id = (item ->> 'user_id')::uuid
        and m.deactivated_at is null
    )
  ) then
    raise exception 'assignee is not an active tenant member' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role) order by a.role, a.user_id), '[]'::jsonb)
    into v_old from public.deal_assignees a where a.tenant_id = d.tenant_id and a.deal_id = d.id;
  delete from public.deal_assignees where tenant_id = d.tenant_id and deal_id = d.id;
  insert into public.deal_assignees (tenant_id, deal_id, user_id, role)
    select d.tenant_id, d.id, (item ->> 'user_id')::uuid, item ->> 'role'
    from jsonb_array_elements(p_assignments) item;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.role) order by a.role, a.user_id), '[]'::jsonb)
    into v_new from public.deal_assignees a where a.tenant_id = d.tenant_id and a.deal_id = d.id;

  update public.deals set version = version + 1 where id = d.id returning version into v_version;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'field_change', 'Assignees updated: ' || v_old::text || ' -> ' || v_new::text);
  return v_version;
end
$$;
revoke all on function public.set_deal_assignees(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_deal_assignees(uuid, integer, jsonb) to authenticated;
