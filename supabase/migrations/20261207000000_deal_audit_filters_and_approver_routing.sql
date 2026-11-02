-- Deal audit attribution, filterable table data, and requester-selected IC approver slots.
-- Audit identities and timestamps are populated by Postgres; the browser cannot write them.

alter table public.deals
  add column created_by uuid,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid;

-- Recover historical creator attribution from the first immutable ledger event where possible.
update public.deals d set
  created_by = (select m.user_id from public.deal_events e
    join public.memberships m on m.tenant_id = e.tenant_id and m.id = e.actor_id
    where e.deal_id = d.id order by e.seq asc limit 1),
  updated_by = (select m.user_id from public.deal_events e
    join public.memberships m on m.tenant_id = e.tenant_id and m.id = e.actor_id
    where e.deal_id = d.id order by e.seq desc limit 1),
  updated_at = coalesce((select e.created_at from public.deal_events e
    where e.deal_id = d.id order by e.seq desc limit 1), d.created_at);

alter table public.deals
  add constraint deals_created_by_membership_fk
    foreign key (tenant_id, created_by) references public.memberships (tenant_id, user_id) on delete restrict,
  add constraint deals_updated_by_membership_fk
    foreign key (tenant_id, updated_by) references public.memberships (tenant_id, user_id) on delete restrict;

create function app.set_deal_audit_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;
    if v_actor is not null then
      if not exists (select 1 from public.memberships m where m.tenant_id = new.tenant_id
        and m.user_id = v_actor and m.deactivated_at is null) then
        raise exception 'active tenant membership required' using errcode = '42501';
      end if;
      new.created_by := v_actor;
      new.updated_by := v_actor;
    else
      new.created_by := null;
      new.updated_by := null;
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    if v_actor is not null then
      if not exists (select 1 from public.memberships m where m.tenant_id = new.tenant_id
        and m.user_id = v_actor and m.deactivated_at is null) then
        raise exception 'active tenant membership required' using errcode = '42501';
      end if;
      new.updated_by := v_actor;
    else
      new.updated_by := null;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.set_deal_audit_fields() from public;
create trigger deals_set_audit_fields before insert or update on public.deals
  for each row execute function app.set_deal_audit_fields();

-- Tenant-scoped invalidation rows contain no domain data. The API relays only the existing
-- content-free `deals_changed` message, so all active tenant views can refresh after admin changes.
create table public.tenant_change_signals (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.tenant_change_signals enable row level security;
alter table public.tenant_change_signals force row level security;
create policy tenant_change_signals_select_member on public.tenant_change_signals
  for select to authenticated using (tenant_id in (select app.my_tenants()));
revoke all on public.tenant_change_signals from public,anon,authenticated,service_role;
grant select on public.tenant_change_signals to authenticated;

create function app.emit_tenant_change_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  v_tenant := coalesce((to_jsonb(new)->>'tenant_id')::uuid,(to_jsonb(old)->>'tenant_id')::uuid);
  if v_tenant is not null then
    insert into public.tenant_change_signals(tenant_id) values(v_tenant)
    on conflict (tenant_id) do update set created_at=now();
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function app.emit_tenant_change_signal() from public;

create trigger tenant_events_emit_signal after insert on public.tenant_events
  for each row execute function app.emit_tenant_change_signal();
create trigger memberships_emit_signal after insert or update or delete on public.memberships
  for each row execute function app.emit_tenant_change_signal();
create trigger membership_roles_emit_signal after insert or update or delete on public.membership_roles
  for each row execute function app.emit_tenant_change_signal();
create trigger roles_emit_signal after insert or update or delete on public.roles
  for each row execute function app.emit_tenant_change_signal();
create trigger invitations_emit_signal after insert or update or delete on public.invitations
  for each row execute function app.emit_tenant_change_signal();
create trigger approval_policy_emit_signal after insert or update or delete on public.approval_policies
  for each row execute function app.emit_tenant_change_signal();
create trigger approval_absence_emit_signal after insert or update or delete on public.approval_absences
  for each row execute function app.emit_tenant_change_signal();
create trigger approval_delegation_emit_signal after insert or update or delete on public.approval_delegations
  for each row execute function app.emit_tenant_change_signal();
create trigger deal_files_emit_signal after insert or update or delete on public.files
  for each row execute function app.emit_tenant_change_signal();

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='tenant_change_signals') then
    alter publication supabase_realtime add table public.tenant_change_signals;
  end if;
end $$;

-- One secured metadata projection is shared by list, detail, My Work and the approval summary.
create function app.deal_metadata(p_deal uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.deals;
  v_request public.approval_requests;
  v_metadata jsonb;
begin
  select * into d from public.deals where id = p_deal and tenant_id in (select app.my_tenants());
  if not found or not app.has_permission(d.tenant_id, 'deal.view') then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  select * into v_request from public.approval_requests r
    where r.tenant_id = d.tenant_id and r.deal_id = d.id
    order by r.created_at desc, r.id desc limit 1;

  select jsonb_build_object(
    'created_by', case when d.created_by is null then null else jsonb_build_object(
      'userId', d.created_by, 'displayName', (select p.display_name from public.profiles p where p.user_id = d.created_by)) end,
    'updated_at', d.updated_at,
    'updated_by', case when d.updated_by is null then null else jsonb_build_object(
      'userId', d.updated_by, 'displayName', (select p.display_name from public.profiles p where p.user_id = d.updated_by)) end,
    'assigned_to', coalesce((select jsonb_agg(jsonb_build_object(
      'userId', a.user_id, 'displayName', p.display_name, 'role', a.role
    ) order by case a.role when 'owner' then 1 when 'lead' then 2 else 3 end, p.display_name, a.user_id)
      from public.deal_assignees a left join public.profiles p on p.user_id = a.user_id
      where a.tenant_id = d.tenant_id and a.deal_id = d.id), '[]'::jsonb),
    'approved_by', case when v_request.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',p.display_name)
        order by p.display_name,m.user_id)
      from public.approval_request_approvers a
      join public.memberships m on m.tenant_id=a.tenant_id and m.id=coalesce(a.decided_by_membership_id,a.membership_id)
      left join public.profiles p on p.user_id=m.user_id
      where a.request_id=v_request.id and a.decision='approve' and a.superseded_by is null
    ),'[]'::jsonb) end,
    'rejected', coalesce(v_request.status='rejected',false),
    'rejection_reason', case when v_request.status='rejected' then (
      select string_agg(coalesce(p.display_name,'Approver') || ': ' || a.decision_reason,E'\\n'
        order by a.decided_at,a.membership_id)
      from public.approval_request_approvers a
      join public.memberships m on m.tenant_id=a.tenant_id and m.id=coalesce(a.decided_by_membership_id,a.membership_id)
      left join public.profiles p on p.user_id=m.user_id
      where a.request_id=v_request.id and a.decision='reject' and a.decision_reason is not null
    ) else null end,
    'approval', jsonb_build_object(
      'requestId', v_request.id,
      'status', v_request.status,
      'requestedBy', case when v_request.id is null then null else (
        select jsonb_build_object('userId', m.user_id, 'displayName', p.display_name)
        from public.memberships m left join public.profiles p on p.user_id = m.user_id
        where m.tenant_id = v_request.tenant_id and m.id = v_request.requested_by) end,
      'approvers', case when v_request.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'userId', coalesce(decided.user_id, slot.user_id), 'displayName', voter.display_name,
          'decision', a.decision, 'reason', a.decision_reason
        ) order by voter.display_name, coalesce(decided.user_id, slot.user_id))
        from public.approval_request_approvers a
        join public.memberships slot on slot.tenant_id = a.tenant_id and slot.id = a.membership_id
        left join public.memberships decided on decided.tenant_id = a.tenant_id
          and decided.id = coalesce(a.decided_by_membership_id, a.membership_id)
        left join public.profiles voter on voter.user_id = coalesce(decided.user_id, slot.user_id)
        where a.tenant_id = v_request.tenant_id and a.request_id = v_request.id and a.superseded_by is null
      ), '[]'::jsonb) end,
      'rejectionReason', case when v_request.status = 'rejected' then (
        select string_agg(coalesce(p.display_name, 'Approver') || ': ' || a.decision_reason, E'\\n'
          order by a.decided_at, a.membership_id)
        from public.approval_request_approvers a
        join public.memberships m on m.tenant_id = a.tenant_id and m.id = coalesce(a.decided_by_membership_id, a.membership_id)
        left join public.profiles p on p.user_id = m.user_id
        where a.request_id = v_request.id and a.decision = 'reject' and a.decision_reason is not null
      ) else null end,
      'approvedBy', case when v_request.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',p.display_name)
          order by p.display_name,m.user_id)
        from public.approval_request_approvers a
        join public.memberships m on m.tenant_id=a.tenant_id and m.id=coalesce(a.decided_by_membership_id,a.membership_id)
        left join public.profiles p on p.user_id=m.user_id
        where a.request_id=v_request.id and a.decision='approve' and a.superseded_by is null
      ),'[]'::jsonb) end,
      'rejected', coalesce(v_request.status='rejected',false)
    )
  ) into v_metadata;
  return v_metadata;
end
$$;
revoke all on function app.deal_metadata(uuid) from public;
grant execute on function app.deal_metadata(uuid) to authenticated;

create or replace function public.deal_dashboard_summary(p_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_timezone text; v_window integer; v_now timestamptz := statement_timestamp();
  v_today date; v_next_midnight timestamptz; v_pipeline jsonb; v_totals jsonb;
  v_closing jsonb; v_closing_count bigint;
begin
  if not app.has_permission(p_tenant,'deal.view') then raise exception 'permission denied' using errcode='42501'; end if;
  select t.timezone,t.closing_soon_days into v_timezone,v_window from public.tenants t where t.id=p_tenant;
  if v_timezone is null or v_window is null then raise exception 'tenant not found' using errcode='P0002'; end if;
  v_today := (v_now at time zone v_timezone)::date;
  v_next_midnight := ((v_today+1)::timestamp at time zone v_timezone);
  select coalesce(jsonb_agg(jsonb_build_object('stage',stages.stage,'count',stages.deal_count) order by stages.ordinal),'[]'::jsonb)
    into v_pipeline from (
      select s.stage,s.ordinal,count(d.id)::integer deal_count
      from (values ('sourcing',1),('screening',2),('due_diligence',3),('ic_review',4),('signed',5),('closed',6),('passed',7)) s(stage,ordinal)
      left join public.deals d on d.tenant_id=p_tenant and d.archived_at is null and d.stage=s.stage
      group by s.stage,s.ordinal
    ) stages;
  select coalesce(jsonb_agg(jsonb_build_object('currency',totals.currency,'amount',totals.amount) order by totals.currency),'[]'::jsonb)
    into v_totals from (
      select d.currency,sum(coalesce(d.amount,0))::text amount from public.deals d
      where d.tenant_id=p_tenant and d.archived_at is null and d.stage not in ('closed','passed') group by d.currency
    ) totals;
  select count(*) into v_closing_count from public.deals d
    where d.tenant_id=p_tenant and d.archived_at is null and d.stage not in ('closed','passed')
      and d.expected_close_date is not null and d.expected_close_date<=v_today+v_window;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',item.id,'name',item.name,'stage',item.stage,'amount',item.amount,'currency',item.currency,
    'expectedCloseDate',item.expected_close_date,'expectedCloseTime',item.expected_close_time,
    'closesInDays',item.expected_close_date-v_today,'closesAt',item.closes_at,
    'created_by',metadata.created_by,'updated_at',metadata.updated_at,'updated_by',metadata.updated_by,
    'assigned_to',metadata.assigned_to,'approved_by',metadata.approved_by,'rejected',metadata.rejected,
    'rejection_reason',metadata.rejection_reason,'approval',metadata.approval
  ) order by item.priority,item.expected_close_date desc,item.name),'[]'::jsonb) into v_closing
  from (
    select d.id,d.name,d.stage,d.amount::text amount,d.currency,d.expected_close_date,d.expected_close_time,
      case when d.expected_close_time is null then null else ((d.expected_close_date+d.expected_close_time) at time zone v_timezone) end closes_at,
      greatest(d.expected_close_date-v_today,0) priority
    from public.deals d where d.tenant_id=p_tenant and d.archived_at is null
      and d.stage not in ('closed','passed') and d.expected_close_date is not null and d.expected_close_date<=v_today+v_window
    order by greatest(d.expected_close_date-v_today,0),d.expected_close_date desc,d.name limit 10
  ) item cross join lateral jsonb_to_record(app.deal_metadata(item.id)) as metadata(
    created_by jsonb,updated_at timestamptz,updated_by jsonb,assigned_to jsonb,
    approved_by jsonb,rejected boolean,rejection_reason text,approval jsonb
  );
  return jsonb_build_object('serverNow',v_now,'nextMidnightAt',v_next_midnight,'timeZone',v_timezone,
    'windowDays',v_window,'pipelineByStage',v_pipeline,'totalsByCurrency',v_totals,
    'closingSoonCount',v_closing_count,'closingSoon',v_closing);
end
$$;
revoke all on function public.deal_dashboard_summary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.deal_dashboard_summary(uuid) to authenticated;

create function public.list_deals_table(
  p_tenant uuid, p_stage text, p_search text, p_sector text, p_assigned_to text,
  p_approval_status text, p_sort text, p_direction text, p_limit integer, p_offset integer
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_total bigint;
  v_items jsonb;
begin
  if not app.has_permission(p_tenant, 'deal.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_stage is not null and p_stage not in ('sourcing','screening','due_diligence','ic_review','signed','closed','passed') then raise exception 'invalid stage' using errcode = '22023'; end if;
  if p_search is not null and char_length(btrim(p_search)) > 100 then raise exception 'search is too long' using errcode = '22023'; end if;
  if p_sector is not null and char_length(btrim(p_sector)) > 100 then raise exception 'sector filter is too long' using errcode = '22023'; end if;
  if p_approval_status is not null and p_approval_status not in ('none','pending','approved','rejected') then raise exception 'invalid approval status' using errcode = '22023'; end if;
  if p_sort is null or p_sort not in ('name','stage','amount','expectedClose','created','updated') or p_direction is null or p_direction not in ('asc','desc') then raise exception 'invalid sort' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 10000 then raise exception 'invalid pagination' using errcode = '22023'; end if;

  with filtered as (
    select d.*, latest.status as approval_status
    from public.deals d
    left join lateral (select r.status from public.approval_requests r where r.tenant_id = d.tenant_id
      and r.deal_id = d.id order by r.created_at desc, r.id desc limit 1) latest on true
    where d.tenant_id = p_tenant and d.archived_at is null
      and (p_stage is null or d.stage = p_stage)
      and (nullif(btrim(p_search), '') is null or strpos(lower(d.name), lower(btrim(p_search))) > 0)
      and (nullif(btrim(p_sector), '') is null or lower(d.sector) = lower(btrim(p_sector)))
      and (nullif(btrim(p_assigned_to), '') is null or exists (select 1 from public.deal_assignees a
        left join public.profiles p on p.user_id=a.user_id
        where a.tenant_id = d.tenant_id and a.deal_id = d.id
          and strpos(lower(coalesce(p.display_name,'')),lower(btrim(p_assigned_to)))>0))
      and (p_approval_status is null or (p_approval_status = 'none' and latest.status is null)
        or latest.status = p_approval_status)
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select d.*, latest.status as approval_status
    from public.deals d
    left join lateral (select r.status from public.approval_requests r where r.tenant_id = d.tenant_id
      and r.deal_id = d.id order by r.created_at desc, r.id desc limit 1) latest on true
    where d.tenant_id = p_tenant and d.archived_at is null
      and (p_stage is null or d.stage = p_stage)
      and (nullif(btrim(p_search), '') is null or strpos(lower(d.name), lower(btrim(p_search))) > 0)
      and (nullif(btrim(p_sector), '') is null or lower(d.sector) = lower(btrim(p_sector)))
      and (nullif(btrim(p_assigned_to), '') is null or exists (select 1 from public.deal_assignees a
        left join public.profiles p on p.user_id=a.user_id
        where a.tenant_id = d.tenant_id and a.deal_id = d.id
          and strpos(lower(coalesce(p.display_name,'')),lower(btrim(p_assigned_to)))>0))
      and (p_approval_status is null or (p_approval_status = 'none' and latest.status is null)
        or latest.status = p_approval_status)
  ), page as (
    select f.* from filtered f
    order by
      case when p_sort = 'name' and p_direction = 'asc' then lower(f.name) end asc,
      case when p_sort = 'name' and p_direction = 'desc' then lower(f.name) end desc,
      case when p_sort = 'stage' and p_direction = 'asc' then f.stage end asc,
      case when p_sort = 'stage' and p_direction = 'desc' then f.stage end desc,
      case when p_sort = 'amount' and p_direction = 'asc' then f.amount end asc nulls last,
      case when p_sort = 'amount' and p_direction = 'desc' then f.amount end desc nulls last,
      case when p_sort = 'expectedClose' and p_direction = 'asc' then f.expected_close_date end asc nulls last,
      case when p_sort = 'expectedClose' and p_direction = 'desc' then f.expected_close_date end desc nulls last,
      case when p_sort = 'created' and p_direction = 'asc' then f.created_at end asc,
      case when p_sort = 'created' and p_direction = 'desc' then f.created_at end desc,
      case when p_sort = 'updated' and p_direction = 'asc' then f.updated_at end asc,
      case when p_sort = 'updated' and p_direction = 'desc' then f.updated_at end desc,
      f.id
    limit p_limit offset p_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'name', page.name, 'stage', page.stage, 'version', page.version,
    'sector', page.sector, 'amount', page.amount::text, 'currency', page.currency,
    'expected_close_date', page.expected_close_date, 'expected_close_time', page.expected_close_time,
    'created_at', page.created_at, 'created_by', metadata.created_by,
    'updated_at', metadata.updated_at, 'updated_by', metadata.updated_by,
    'assigned_to', metadata.assigned_to, 'approved_by', metadata.approved_by,
    'rejected', metadata.rejected, 'rejection_reason', metadata.rejection_reason,
    'approval', metadata.approval
  ) order by page.id), '[]'::jsonb) into v_items
  from page cross join lateral jsonb_to_record(app.deal_metadata(page.id)) as metadata(
    created_by jsonb, updated_at timestamptz, updated_by jsonb, assigned_to jsonb,
    approved_by jsonb, rejected boolean, rejection_reason text, approval jsonb
  );
  return jsonb_build_object('total', v_total, 'items', v_items);
end
$$;
revoke all on function public.list_deals_table(uuid,text,text,text,text,text,text,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.list_deals_table(uuid,text,text,text,text,text,text,text,integer,integer) to authenticated;

create or replace function public.deal_detail(p_deal uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  d public.deals;
  v_metadata jsonb;
begin
  select * into d from public.deals where id = p_deal and tenant_id in (select app.my_tenants()) and archived_at is null;
  if not found or not app.has_permission(d.tenant_id, 'deal.view') then raise exception 'deal not found' using errcode = 'P0002'; end if;
  v_metadata := app.deal_metadata(d.id);
  return jsonb_build_object(
    'id',d.id,'name',d.name,'stage',d.stage,'version',d.version,'sector',d.sector,
    'amount',d.amount::text,'currency',d.currency,'expected_close_date',d.expected_close_date,
    'expected_close_time',d.expected_close_time,'created_at',d.created_at,
    'created_by',v_metadata->'created_by','updated_at',v_metadata->'updated_at',
    'updated_by',v_metadata->'updated_by','assigned_to',v_metadata->'assigned_to',
    'approved_by',v_metadata->'approved_by','rejected',v_metadata->'rejected',
    'rejection_reason',v_metadata->'rejection_reason','approval',v_metadata->'approval'
  );
end
$$;

create or replace function public.list_my_deal_work(p_tenant uuid, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_total bigint; v_active_count bigint; v_items jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 10000 then raise exception 'invalid pagination' using errcode = '22023'; end if;
  if not app.has_permission(p_tenant, 'deal.view') then raise exception 'permission denied' using errcode = '42501'; end if;
  select count(*), count(*) filter (where d.stage not in ('closed','passed')) into v_total, v_active_count
  from public.deals d join public.deal_assignees a on a.tenant_id=d.tenant_id and a.deal_id=d.id
  where d.tenant_id=p_tenant and d.archived_at is null and a.user_id=app.uid();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',page.id,'name',page.name,'stage',page.stage,'version',page.version,'sector',page.sector,
    'amount',page.amount::text,'currency',page.currency,'expected_close_date',page.expected_close_date,
    'expected_close_time',page.expected_close_time,'created_at',page.created_at,'assignment_role',page.assignment_role,
    'created_by',metadata.created_by,'updated_at',metadata.updated_at,'updated_by',metadata.updated_by,
    'assigned_to',metadata.assigned_to,'approved_by',metadata.approved_by,
    'rejected',metadata.rejected,'rejection_reason',metadata.rejection_reason,'approval',metadata.approval
  ) order by page.expected_close_date nulls last,page.created_at desc,page.id),'[]'::jsonb) into v_items
  from (
    select d.*, a.role as assignment_role from public.deals d
    join public.deal_assignees a on a.tenant_id=d.tenant_id and a.deal_id=d.id
    where d.tenant_id=p_tenant and d.archived_at is null and a.user_id=app.uid()
    order by d.expected_close_date nulls last,d.created_at desc,d.id limit p_limit offset p_offset
  ) page cross join lateral jsonb_to_record(app.deal_metadata(page.id)) as metadata(
    created_by jsonb, updated_at timestamptz, updated_by jsonb, assigned_to jsonb,
    approved_by jsonb, rejected boolean, rejection_reason text, approval jsonb
  );
  return jsonb_build_object('total',v_total,'activeCount',v_active_count,'items',v_items);
end
$$;

-- Return the exact eligible tenant members and their permission-bearing roles to an authorized requester.
create function public.eligible_deal_approvers(p_deal uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.deals; v_requester uuid; v_rows jsonb;
begin
  select * into d from public.deals where id=p_deal and tenant_id in (select app.my_tenants());
  if not found or not app.has_permission(d.tenant_id,'deal.request_approval') then raise exception 'permission denied' using errcode='42501'; end if;
  select m.id into v_requester from public.memberships m where m.tenant_id=d.tenant_id and m.user_id=app.uid() and m.deactivated_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'membershipId',eligible.membership_id,'userId',eligible.user_id,'displayName',eligible.display_name,
    'roles',eligible.roles,'delegatedTo',eligible.delegate_name
  ) order by eligible.display_name,eligible.membership_id),'[]'::jsonb) into v_rows
  from (
    select m.id membership_id,m.user_id,p.display_name,
      array_agg(distinct role.name order by role.name) roles,
      delegate_profile.display_name delegate_name
    from public.memberships m
    join public.membership_roles mr on mr.tenant_id=m.tenant_id and mr.membership_id=m.id
    join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id and rp.permission='approval.decide'
    join public.roles role on role.tenant_id=mr.tenant_id and role.id=mr.role_id
    left join public.profiles p on p.user_id=m.user_id
    left join public.memberships delegate on delegate.id=app.active_approval_delegate(d.tenant_id,m.id)
    left join public.profiles delegate_profile on delegate_profile.user_id=delegate.user_id
    where m.tenant_id=d.tenant_id and m.deactivated_at is null and m.id<>v_requester
      and app.active_approval_principal(d.tenant_id,m.id) is null
      and app.active_approval_delegate(d.tenant_id,m.id) is distinct from v_requester
      and (not exists(select 1 from public.approval_absences a where a.tenant_id=m.tenant_id and a.membership_id=m.id
        and a.cancelled_at is null and a.starts_at<=now() and a.ends_at>now())
        or app.active_approval_delegate(d.tenant_id,m.id) is not null)
    group by m.id,m.user_id,p.display_name,delegate_profile.display_name
  ) eligible;
  return jsonb_build_object('requiredApprovals',(select required_approvals from public.approval_policies where tenant_id=d.tenant_id),'approvers',v_rows);
end
$$;
revoke all on function public.eligible_deal_approvers(uuid) from public,anon,authenticated,service_role;
grant execute on function public.eligible_deal_approvers(uuid) to authenticated;

create function public.request_approval_to(p_deal uuid,p_expected_version integer,p_approver_memberships uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d public.deals; v_requester uuid; v_quorum integer; v_request uuid; v_eligible uuid[];
begin
  select * into d from public.deals where id=p_deal and tenant_id in (select app.my_tenants()) for update;
  if not found then raise exception 'deal not found' using errcode='P0002'; end if;
  if not app.has_permission(d.tenant_id,'deal.request_approval') then raise exception 'permission denied' using errcode='42501'; end if;
  if d.archived_at is not null then raise exception 'deal is archived' using errcode='55000'; end if;
  if p_expected_version is null or d.version is distinct from p_expected_version then raise exception 'stale version' using errcode='DP409'; end if;
  if d.stage<>'ic_review' then raise exception 'deal is not at IC review' using errcode='DP422'; end if;
  if exists(select 1 from public.approval_requests r where r.tenant_id=d.tenant_id and r.deal_id=d.id and r.status='pending') then
    raise exception 'approval request is pending' using errcode='DP422';
  end if;
  select required_approvals into v_quorum from public.approval_policies where tenant_id=d.tenant_id for update;
  if v_quorum is null then raise exception 'approval policy is not configured' using errcode='DP422'; end if;
  select id into v_requester from public.memberships where tenant_id=d.tenant_id and user_id=app.uid() and deactivated_at is null;
  if v_requester is null then raise exception 'permission denied' using errcode='42501'; end if;
  if p_approver_memberships is null or cardinality(p_approver_memberships)=0 or cardinality(p_approver_memberships)>50
     or cardinality(p_approver_memberships)<>(select count(distinct x) from unnest(p_approver_memberships) x) then
    raise exception 'select unique eligible approvers' using errcode='22023';
  end if;
  select array_agg(candidate.membership_id) into v_eligible from (
    select m.id membership_id from public.memberships m
    join public.membership_roles mr on mr.tenant_id=m.tenant_id and mr.membership_id=m.id
    join public.role_permissions rp on rp.tenant_id=mr.tenant_id and rp.role_id=mr.role_id and rp.permission='approval.decide'
    where m.tenant_id=d.tenant_id and m.deactivated_at is null and m.id<>v_requester
      and app.active_approval_principal(d.tenant_id,m.id) is null
      and app.active_approval_delegate(d.tenant_id,m.id) is distinct from v_requester
      and (not exists(select 1 from public.approval_absences a where a.tenant_id=m.tenant_id and a.membership_id=m.id
        and a.cancelled_at is null and a.starts_at<=now() and a.ends_at>now())
        or app.active_approval_delegate(d.tenant_id,m.id) is not null)
    group by m.id
  ) candidate where candidate.membership_id=any(p_approver_memberships);
  if coalesce(cardinality(v_eligible),0)<>cardinality(p_approver_memberships) then raise exception 'one or more selected approvers are no longer eligible' using errcode='DP422'; end if;
  if cardinality(v_eligible)<v_quorum then raise exception 'selected approvers do not meet the configured quorum' using errcode='DP422'; end if;
  insert into public.approval_requests(tenant_id,deal_id,requested_by,required_approvals)
    values(d.tenant_id,d.id,v_requester,v_quorum) returning id into v_request;
  insert into public.approval_request_approvers(tenant_id,request_id,membership_id)
    select d.tenant_id,v_request,x from unnest(v_eligible) x;
  insert into public.deal_events(tenant_id,deal_id,kind,body)
    values(d.tenant_id,d.id,'approval_decision',format('Approval requested: quorum %s; assigned to %s approver(s)',v_quorum,cardinality(v_eligible)));
  return v_request;
end
$$;
revoke all on function public.request_approval_to(uuid,integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.request_approval_to(uuid,integer,uuid[]) to authenticated;
