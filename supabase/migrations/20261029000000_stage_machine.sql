-- Feature 01, slice 3: deal fields, the stage machine and its two write functions (ADR 0002, E1).
-- The machine and the required fields are data; move_stage is the only way a stage changes.

alter table public.deals
  add column sector text check (char_length(sector) between 1 and 100),
  add column amount bigint check (amount >= 0),  -- minor units of `currency`; the wire carries it as a string (E10)
  add column currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  add column expected_close_date date,
  add column expected_close_time time;

create table public.stage_transitions (
  from_stage text not null check (from_stage in ('sourcing', 'screening', 'due_diligence', 'ic_review', 'signed', 'closed', 'passed')),
  to_stage text not null check (to_stage in ('sourcing', 'screening', 'due_diligence', 'ic_review', 'signed', 'closed', 'passed')),
  primary key (from_stage, to_stage)
);

-- ic_review -> signed is deliberately absent: signing follows the approval decision (feature 04),
-- so until that exists nobody can reach `signed`. closed and passed are terminal.
insert into public.stage_transitions (from_stage, to_stage) values
  ('sourcing', 'screening'),
  ('screening', 'due_diligence'),
  ('due_diligence', 'ic_review'),
  ('ic_review', 'due_diligence'),
  ('signed', 'closed'),
  ('sourcing', 'passed'),
  ('screening', 'passed'),
  ('due_diligence', 'passed'),
  ('ic_review', 'passed'),
  ('signed', 'passed');

create table public.stage_requirements (
  stage text not null check (stage in ('sourcing', 'screening', 'due_diligence', 'ic_review', 'signed', 'closed', 'passed')),
  field text not null,  -- a column of public.deals; a test keeps this honest
  primary key (stage, field)
);
insert into public.stage_requirements (stage, field)
select s.stage, f.field
from (values ('screening'), ('due_diligence'), ('ic_review'), ('signed'), ('closed')) as s(stage)
cross join (values ('sector'), ('amount')) as f(field);
insert into public.stage_requirements (stage, field)
select s.stage, 'expected_close_date'
from (values ('due_diligence'), ('ic_review'), ('signed'), ('closed')) as s(stage);

alter table public.stage_transitions enable row level security;
alter table public.stage_transitions force row level security;
alter table public.stage_requirements enable row level security;
alter table public.stage_requirements force row level security;
create policy stage_transitions_select on public.stage_transitions for select to authenticated using (true);
create policy stage_requirements_select on public.stage_requirements for select to authenticated using (true);
revoke all on public.stage_transitions, public.stage_requirements from public, anon, authenticated, service_role;
grant select on public.stage_transitions, public.stage_requirements to authenticated;

-- The caller names the tenant; the database checks the caller holds deal.create there.
create function public.create_deal(
  p_tenant uuid,
  p_name text,
  p_sector text default null,
  p_amount bigint default null,
  p_currency text default 'ZAR',
  p_expected_close date default null
) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.has_permission(p_tenant, 'deal.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into public.deals (tenant_id, name, sector, amount, currency, expected_close_date)
    values (p_tenant, p_name, p_sector, p_amount, p_currency, p_expected_close)
    returning id into v_id;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (p_tenant, v_id, 'field_change', 'Deal created');
  return v_id;
end
$$;
revoke all on function public.create_deal(uuid, text, text, bigint, text, date) from public, anon, authenticated, service_role;
grant execute on function public.create_deal(uuid, text, text, bigint, text, date) to authenticated;

-- Errors: DP409 stale version, DP422 rule violation (the API maps them to 409 and 422). The deal row
-- is locked, so two concurrent moves cannot both succeed against the same version.
create function public.move_stage(p_deal uuid, p_to text, p_expected_version integer, p_reason text default null)
  returns integer
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_missing text;
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
  if not exists (select 1 from public.stage_transitions t where t.from_stage = d.stage and t.to_stage = p_to) then
    raise exception 'transition not allowed' using errcode = 'DP422';
  end if;

  select string_agg(r.field, ', ' order by r.field) into v_missing
    from public.stage_requirements r
    where r.stage = p_to and to_jsonb(d) ->> r.field is null;
  if v_missing is not null then
    raise exception 'missing required fields: %', v_missing using errcode = 'DP422';
  end if;

  update public.deals set stage = p_to, version = version + 1 where id = d.id returning version into v_version;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'stage_change',
            d.stage || ' -> ' || p_to || case when nullif(p_reason, '') is not null then ': ' || p_reason else '' end);
  return v_version;
end
$$;
revoke all on function public.move_stage(uuid, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.move_stage(uuid, text, integer, text) to authenticated;
