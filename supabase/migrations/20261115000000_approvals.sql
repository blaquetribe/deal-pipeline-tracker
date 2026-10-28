-- Feature 04, slice 1: a tenant-configured k-of-N IC gate. Requests snapshot the eligible
-- approvers; decisions and the resulting stage change are serialized under the deal row lock.

create table public.approval_policies (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  stage text not null default 'ic_review' check (stage = 'ic_review'),
  required_approvals integer not null check (required_approvals > 0),
  updated_at timestamptz not null default now()
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  deal_id uuid not null,
  requested_by uuid not null,
  required_approvals integer not null check (required_approvals > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, deal_id) references public.deals (tenant_id, id) on delete restrict,
  foreign key (tenant_id, requested_by) references public.memberships (tenant_id, id) on delete restrict,
  check ((status = 'pending' and completed_at is null) or (status <> 'pending' and completed_at is not null))
);
create unique index approval_requests_one_pending_per_deal_idx
  on public.approval_requests (tenant_id, deal_id) where status = 'pending';
create index approval_requests_tenant_status_idx on public.approval_requests (tenant_id, status, created_at);

create table public.approval_request_approvers (
  tenant_id uuid not null,
  request_id uuid not null,
  membership_id uuid not null,
  decision text check (decision in ('approve', 'reject')),
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 2000),
  decided_at timestamptz,
  primary key (request_id, membership_id),
  foreign key (tenant_id, request_id) references public.approval_requests (tenant_id, id) on delete restrict,
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id) on delete restrict,
  check ((decision is null and decided_at is null) or (decision is not null and decided_at is not null))
);
create index approval_request_approvers_membership_idx
  on public.approval_request_approvers (tenant_id, membership_id, request_id);

alter table public.approval_policies enable row level security;
alter table public.approval_policies force row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_requests force row level security;
alter table public.approval_request_approvers enable row level security;
alter table public.approval_request_approvers force row level security;

create policy approval_policies_select_admin on public.approval_policies
  for select to authenticated using ((select app.has_permission(tenant_id, 'role.manage')));
create policy approval_requests_select_member on public.approval_requests
  for select to authenticated using ((select app.has_permission(tenant_id, 'deal.view')));
create policy approval_request_approvers_select_member on public.approval_request_approvers
  for select to authenticated using ((select app.has_permission(tenant_id, 'deal.view')));

revoke all on public.approval_policies, public.approval_requests, public.approval_request_approvers
  from public, anon, authenticated, service_role;
grant select on public.approval_policies, public.approval_requests, public.approval_request_approvers to authenticated;

-- Prevent moving a deal out of IC review while its approval request is open. The final decision
-- marks the request complete before moving to signed, in the same transaction.
create function app.prevent_stage_change_with_pending_approval() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage and exists (
    select 1 from public.approval_requests r
    where r.tenant_id = old.tenant_id and r.deal_id = old.id and r.status = 'pending'
  ) then
    raise exception 'approval request is pending' using errcode = 'DP422';
  end if;
  return new;
end
$$;
revoke all on function app.prevent_stage_change_with_pending_approval() from public;
create trigger deals_prevent_stage_change_with_pending_approval
  before update of stage on public.deals
  for each row execute function app.prevent_stage_change_with_pending_approval();

create function public.configure_approval_policy(p_tenant uuid, p_required_approvals integer) returns void
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if p_required_approvals is null or p_required_approvals < 1 then
    raise exception 'invalid approval quorum' using errcode = '22023';
  end if;
  if not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.approval_policies (tenant_id, required_approvals)
    values (p_tenant, p_required_approvals)
  on conflict (tenant_id) do update set
    required_approvals = excluded.required_approvals,
    updated_at = now();
end
$$;
revoke all on function public.configure_approval_policy(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.configure_approval_policy(uuid, integer) to authenticated;

create function public.request_approval(p_deal uuid, p_expected_version integer) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  d public.deals;
  v_requester uuid;
  v_policy integer;
  v_eligible integer;
  v_request uuid;
begin
  select * into d from public.deals
    where id = p_deal and tenant_id in (select app.my_tenants())
    for update;
  if not found then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  if not app.has_permission(d.tenant_id, 'deal.request_approval') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if d.archived_at is not null then
    raise exception 'deal is archived' using errcode = '55000';
  end if;
  if d.version is distinct from p_expected_version then
    raise exception 'stale version' using errcode = 'DP409';
  end if;
  if d.stage <> 'ic_review' then
    raise exception 'deal is not at IC review' using errcode = 'DP422';
  end if;
  select p.required_approvals into v_policy from public.approval_policies p where p.tenant_id = d.tenant_id;
  if v_policy is null then
    raise exception 'approval policy is not configured' using errcode = 'DP422';
  end if;
  select m.id into v_requester from public.memberships m
    where m.tenant_id = d.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  if v_requester is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select count(distinct m.id)::integer into v_eligible
  from public.memberships m
  join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
  join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
  where m.tenant_id = d.tenant_id and m.deactivated_at is null
    and m.id <> v_requester and rp.permission = 'approval.decide';
  if v_eligible < v_policy then
    raise exception 'approval quorum exceeds eligible approvers' using errcode = 'DP422';
  end if;
  insert into public.approval_requests (tenant_id, deal_id, requested_by, required_approvals)
    values (d.tenant_id, d.id, v_requester, v_policy) returning id into v_request;
  insert into public.approval_request_approvers (tenant_id, request_id, membership_id)
  select d.tenant_id, v_request, m.id
  from public.memberships m
  join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
  join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
  where m.tenant_id = d.tenant_id and m.deactivated_at is null
    and m.id <> v_requester and rp.permission = 'approval.decide'
  group by m.id;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'approval_decision',
      format('Approval requested: %s of %s eligible approvers', v_policy, v_eligible));
  return v_request;
end
$$;
revoke all on function public.request_approval(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.request_approval(uuid, integer) to authenticated;

create function public.decide_approval(p_request uuid, p_decision text, p_reason text default null) returns text
  language plpgsql security definer
  set search_path = ''
as $$
declare
  r public.approval_requests;
  d public.deals;
  v_membership uuid;
  v_approved integer;
  v_pending integer;
  v_status text;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 2000 then
    raise exception 'decision reason is too long' using errcode = '22023';
  end if;
  select * into r from public.approval_requests
    where id = p_request and tenant_id in (select app.my_tenants());
  if not found then
    raise exception 'approval request not found' using errcode = 'P0002';
  end if;
  select * into d from public.deals where id = r.deal_id and tenant_id = r.tenant_id for update;
  if not found then
    raise exception 'approval request not found' using errcode = 'P0002';
  end if;
  select * into r from public.approval_requests where id = p_request for update;
  if r.status <> 'pending' then
    raise exception 'approval request is not pending' using errcode = '55000';
  end if;
  if not app.has_permission(r.tenant_id, 'approval.decide') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = r.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  if v_membership is null or v_membership = r.requested_by then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  perform 1 from public.approval_request_approvers a
    where a.tenant_id = r.tenant_id and a.request_id = r.id and a.membership_id = v_membership
    for update;
  if not found then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if exists (select 1 from public.approval_request_approvers a
    where a.request_id = r.id and a.membership_id = v_membership and a.decision is not null) then
    raise exception 'approval decision already recorded' using errcode = '23505';
  end if;
  if d.stage <> 'ic_review' then
    raise exception 'deal is not at IC review' using errcode = 'DP422';
  end if;
  update public.approval_request_approvers set
    decision = p_decision, decision_reason = nullif(p_reason, ''), decided_at = now()
  where request_id = r.id and membership_id = v_membership;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (r.tenant_id, r.deal_id, 'approval_decision',
      format('Approval %s%s', p_decision, case when nullif(p_reason, '') is not null then ': ' || p_reason else '' end));
  select count(*) filter (where a.decision = 'approve')::integer,
         count(*) filter (where a.decision is null)::integer
    into v_approved, v_pending from public.approval_request_approvers a where a.request_id = r.id;
  if v_approved >= r.required_approvals then
    v_status := 'approved';
  elsif v_approved + v_pending < r.required_approvals then
    v_status := 'rejected';
  else
    return 'pending';
  end if;
  update public.approval_requests set status = v_status, completed_at = now() where id = r.id;
  if v_status = 'approved' then
    update public.deals set stage = 'signed', version = version + 1 where id = d.id returning * into d;
    insert into public.deal_events (tenant_id, deal_id, kind, body)
      values (r.tenant_id, r.deal_id, 'stage_change', 'ic_review -> signed: approval quorum reached');
  end if;
  return v_status;
end
$$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;
