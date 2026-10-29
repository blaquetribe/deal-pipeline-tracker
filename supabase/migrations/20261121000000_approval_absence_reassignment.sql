-- Feature 04 follow-up: an approver can record a bounded absence, and an Owner/Admin can
-- replace an unavailable pending slot without erasing the original approval snapshot.

create table public.approval_absences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  membership_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id) references public.memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, cancelled_by) references public.memberships (tenant_id, id) on delete restrict,
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '365 days'),
  check ((cancelled_at is null) = (cancelled_by is null))
);
create index approval_absences_active_member_idx
  on public.approval_absences (tenant_id, membership_id, starts_at, ends_at)
  where cancelled_at is null;

alter table public.tenant_events drop constraint tenant_events_kind_check;
alter table public.tenant_events add constraint tenant_events_kind_check
  check (kind in ('tenant_created', 'role_granted', 'role_revoked', 'member_deactivated', 'ownership_transferred',
                  'settings_changed', 'invitation_sent', 'invitation_revoked', 'invitation_accepted',
                  'approval_absence_set', 'approval_absence_cancelled'));
alter table public.approval_absences enable row level security;
alter table public.approval_absences force row level security;
create policy approval_absences_select_self_or_manager on public.approval_absences
  for select to authenticated using (
    membership_id in (select m.id from public.memberships m where m.user_id = (select app.uid()))
    or (select app.has_permission(tenant_id, 'member.manage'))
  );
revoke all on public.approval_absences from public, anon, authenticated, service_role;
grant select on public.approval_absences to authenticated;

alter table public.approval_request_approvers
  add column superseded_by uuid,
  add column superseded_at timestamptz,
  add column superseded_by_actor uuid,
  add constraint approval_request_approvers_superseded_member_fk
    foreign key (tenant_id, superseded_by) references public.memberships (tenant_id, id) on delete restrict,
  add constraint approval_request_approvers_superseded_actor_fk
    foreign key (tenant_id, superseded_by_actor) references public.memberships (tenant_id, id) on delete restrict,
  add constraint approval_request_approvers_superseded_fields_check check (
    (superseded_by is null and superseded_at is null and superseded_by_actor is null)
    or (superseded_by is not null and superseded_at is not null and superseded_by_actor is not null)
  );

create function public.set_approval_absence(p_tenant uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_membership uuid;
  v_absence uuid;
begin
  if p_tenant is null or p_starts_at is null or p_ends_at is null
    or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '365 days' then
    raise exception 'invalid approval absence window' using errcode = '22023';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = app.uid() and m.deactivated_at is null
    for update;
  if v_membership is null or not app.has_permission(p_tenant, 'approval.decide') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.approval_absences a
    where a.tenant_id = p_tenant and a.membership_id = v_membership and a.cancelled_at is null
      and a.starts_at < p_ends_at and p_starts_at < a.ends_at
  ) then
    raise exception 'approval absence overlaps an existing window' using errcode = '23505';
  end if;
  insert into public.approval_absences (tenant_id, membership_id, starts_at, ends_at)
    values (p_tenant, v_membership, p_starts_at, p_ends_at) returning id into v_absence;
  insert into public.tenant_events (tenant_id, kind, subject_user_id, detail)
    values (p_tenant, 'approval_absence_set', app.uid(),
      format('Approval absence %s scheduled from %s through %s', v_absence, p_starts_at, p_ends_at));
  return v_absence;
end
$$;
revoke all on function public.set_approval_absence(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.set_approval_absence(uuid, timestamptz, timestamptz) to authenticated;

create function public.cancel_approval_absence(p_absence uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.approval_absences;
  v_actor uuid;
begin
  select * into a from public.approval_absences
    where id = p_absence and tenant_id in (select app.my_tenants()) and cancelled_at is null for update;
  if not found then raise exception 'approval absence not found' using errcode = 'P0002'; end if;
  select m.id into v_actor from public.memberships m
    where m.tenant_id = a.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  if v_actor is null or a.membership_id <> v_actor then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.approval_absences set cancelled_at = now(), cancelled_by = v_actor where id = a.id;
  insert into public.tenant_events (tenant_id, kind, subject_user_id, detail)
    values (a.tenant_id, 'approval_absence_cancelled', app.uid(),
      format('Approval absence %s cancelled (scheduled from %s through %s)', a.id, a.starts_at, a.ends_at));
end
$$;
revoke all on function public.cancel_approval_absence(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_approval_absence(uuid) to authenticated;

create function public.reassign_approval_approver(p_request uuid, p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.approval_requests;
  d public.deals;
  v_actor uuid;
begin
  select * into r from public.approval_requests
    where id = p_request and tenant_id in (select app.my_tenants());
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  select * into d from public.deals where id = r.deal_id and tenant_id = r.tenant_id for update;
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  select * into r from public.approval_requests where id = p_request for update;
  if r.status <> 'pending' then raise exception 'approval request is not pending' using errcode = '55000'; end if;
  if not app.has_permission(r.tenant_id, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.id into v_actor from public.memberships m
    where m.tenant_id = r.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  if v_actor is null then raise exception 'permission denied' using errcode = '42501'; end if;
  perform 1 from public.approval_request_approvers a
    where a.tenant_id = r.tenant_id and a.request_id = r.id and a.membership_id = p_from
      and a.decision is null and a.superseded_by is null
      and (
        exists (select 1 from public.approval_absences absence
          where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
            and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
        or not exists (select 1 from public.memberships m
          join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
          join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
          where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
            and rp.permission = 'approval.decide')
      )
    for update;
  if not found then raise exception 'approver is not unavailable' using errcode = 'DP422'; end if;
  if p_to is null or p_to = r.requested_by or p_to = p_from
    or not exists (
      select 1 from public.memberships m
      join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where m.tenant_id = r.tenant_id and m.id = p_to and m.deactivated_at is null
        and rp.permission = 'approval.decide'
    )
    or exists (select 1 from public.membership_roles mr
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where mr.tenant_id = r.tenant_id and mr.membership_id = p_to and rp.permission = 'deal.request_approval')
    or exists (select 1 from public.approval_request_approvers a
      where a.request_id = r.id and a.membership_id = p_to)
    or exists (select 1 from public.approval_absences absence
      where absence.tenant_id = r.tenant_id and absence.membership_id = p_to
        and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()) then
    raise exception 'replacement approver is not eligible' using errcode = 'DP422';
  end if;
  insert into public.approval_request_approvers (tenant_id, request_id, membership_id)
    values (r.tenant_id, r.id, p_to);
  update public.approval_request_approvers set
    superseded_by = p_to, superseded_at = now(), superseded_by_actor = v_actor
    where tenant_id = r.tenant_id and request_id = r.id and membership_id = p_from;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (r.tenant_id, r.deal_id, 'approval_decision',
      format('Approval approver reassigned: membership %s -> membership %s', p_from, p_to));
end
$$;
revoke all on function public.reassign_approval_approver(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reassign_approval_approver(uuid, uuid, uuid) to authenticated;

create or replace function public.request_approval(p_deal uuid, p_expected_version integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.deals;
  v_requester uuid;
  v_policy integer;
  v_eligible integer;
  v_request uuid;
begin
  select * into d from public.deals
    where id = p_deal and tenant_id in (select app.my_tenants()) for update;
  if not found then raise exception 'deal not found' using errcode = 'P0002'; end if;
  if not app.has_permission(d.tenant_id, 'deal.request_approval') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if d.archived_at is not null then raise exception 'deal is archived' using errcode = '55000'; end if;
  if d.version is distinct from p_expected_version then raise exception 'stale version' using errcode = 'DP409'; end if;
  if d.stage <> 'ic_review' then raise exception 'deal is not at IC review' using errcode = 'DP422'; end if;
  select p.required_approvals into v_policy from public.approval_policies p where p.tenant_id = d.tenant_id;
  if v_policy is null then raise exception 'approval policy is not configured' using errcode = 'DP422'; end if;
  select m.id into v_requester from public.memberships m
    where m.tenant_id = d.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  if v_requester is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select count(distinct m.id)::integer into v_eligible
  from public.memberships m
  join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
  join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
  where m.tenant_id = d.tenant_id and m.deactivated_at is null and m.id <> v_requester
    and rp.permission = 'approval.decide'
    and not exists (select 1 from public.approval_absences a
      where a.tenant_id = m.tenant_id and a.membership_id = m.id and a.cancelled_at is null
        and a.starts_at <= now() and a.ends_at > now());
  if v_eligible < v_policy then raise exception 'approval quorum exceeds eligible approvers' using errcode = 'DP422'; end if;
  insert into public.approval_requests (tenant_id, deal_id, requested_by, required_approvals)
    values (d.tenant_id, d.id, v_requester, v_policy) returning id into v_request;
  insert into public.approval_request_approvers (tenant_id, request_id, membership_id)
  select d.tenant_id, v_request, m.id
  from public.memberships m
  join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
  join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
  where m.tenant_id = d.tenant_id and m.deactivated_at is null and m.id <> v_requester
    and rp.permission = 'approval.decide'
    and not exists (select 1 from public.approval_absences a
      where a.tenant_id = m.tenant_id and a.membership_id = m.id and a.cancelled_at is null
        and a.starts_at <= now() and a.ends_at > now())
  group by m.id;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'approval_decision',
      format('Approval requested: %s of %s eligible approvers', v_policy, v_eligible));
  return v_request;
end
$$;
revoke all on function public.request_approval(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.request_approval(uuid, integer) to authenticated;

create or replace function public.decide_approval(p_request uuid, p_decision text, p_reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
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
  if p_reason is not null and char_length(p_reason) > 2000 then raise exception 'decision reason is too long' using errcode = '22023'; end if;
  select * into r from public.approval_requests
    where id = p_request and tenant_id in (select app.my_tenants());
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  select * into d from public.deals where id = r.deal_id and tenant_id = r.tenant_id for update;
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  select * into r from public.approval_requests where id = p_request for update;
  if r.status <> 'pending' then raise exception 'approval request is not pending' using errcode = '55000'; end if;
  if not app.has_permission(r.tenant_id, 'approval.decide') then raise exception 'permission denied' using errcode = '42501'; end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = r.tenant_id and m.user_id = app.uid() and m.deactivated_at is null
    for update;
  if v_membership is null or v_membership = r.requested_by then raise exception 'permission denied' using errcode = '42501'; end if;
  perform 1 from public.approval_request_approvers a
    where a.tenant_id = r.tenant_id and a.request_id = r.id and a.membership_id = v_membership
      and a.superseded_by is null for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  if exists (select 1 from public.approval_absences absence
    where absence.tenant_id = r.tenant_id and absence.membership_id = v_membership
      and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()) then
    raise exception 'approver is absent' using errcode = 'DP422';
  end if;
  if exists (select 1 from public.approval_request_approvers a
    where a.request_id = r.id and a.membership_id = v_membership and a.decision is not null) then
    raise exception 'approval decision already recorded' using errcode = '23505';
  end if;
  if d.stage <> 'ic_review' then raise exception 'deal is not at IC review' using errcode = 'DP422'; end if;
  update public.approval_request_approvers set
    decision = p_decision, decision_reason = nullif(p_reason, ''), decided_at = now()
  where request_id = r.id and membership_id = v_membership and superseded_by is null;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (r.tenant_id, r.deal_id, 'approval_decision',
      format('Approval %s%s', p_decision, case when nullif(p_reason, '') is not null then ': ' || p_reason else '' end));
  select count(*) filter (where a.decision = 'approve')::integer,
         count(*) filter (where a.decision is null and a.superseded_by is null
           and exists (select 1 from public.memberships m
             join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
             join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
             where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
               and rp.permission = 'approval.decide')
           and not exists (select 1 from public.approval_absences absence
             where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
               and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()))::integer
    into v_approved, v_pending from public.approval_request_approvers a where a.request_id = r.id;
  if v_approved >= r.required_approvals then v_status := 'approved';
  elsif v_approved + v_pending < r.required_approvals then v_status := 'rejected';
  else return 'pending'; end if;
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

create or replace function public.deal_approval_status(p_deal uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.deals;
  r public.approval_requests;
  v_membership uuid;
  v_approved integer := 0;
  v_pending integer := 0;
  v_rejected integer := 0;
  v_decision text;
  v_is_requester boolean := false;
  v_configured_approvals integer;
  v_can_decide boolean := false;
  v_has_unavailable_approver boolean := false;
begin
  select * into d from public.deals
    where id = p_deal and tenant_id in (select app.my_tenants());
  if not found or not app.has_permission(d.tenant_id, 'deal.view') then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = d.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  select p.required_approvals into v_configured_approvals
    from public.approval_policies p where p.tenant_id = d.tenant_id;
  select * into r from public.approval_requests a
    where a.tenant_id = d.tenant_id and a.deal_id = d.id
    order by a.created_at desc, a.id desc limit 1;
  if found then
    select count(*) filter (where a.decision = 'approve')::integer,
           count(*) filter (where a.decision is null and a.superseded_by is null
             and exists (select 1 from public.memberships m
               join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
               join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
               where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
                 and rp.permission = 'approval.decide')
             and not exists (select 1 from public.approval_absences absence
               where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
                 and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()))::integer,
           count(*) filter (where a.decision = 'reject')::integer
      into v_approved, v_pending, v_rejected
      from public.approval_request_approvers a where a.request_id = r.id;
    v_is_requester := r.requested_by = v_membership;
    select a.decision into v_decision from public.approval_request_approvers a
      where a.request_id = r.id and a.membership_id = v_membership and a.superseded_by is null;
    select exists (
      select 1 from public.approval_request_approvers a
      where a.request_id = r.id and a.decision is null and a.superseded_by is null
        and (
          exists (select 1 from public.approval_absences absence
            where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
              and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
          or not exists (select 1 from public.memberships m
            join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
            join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
            where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
              and rp.permission = 'approval.decide')
        )
    ) into v_has_unavailable_approver;
    select exists (
      select 1 from public.approval_request_approvers a
      where a.request_id = r.id and a.membership_id = v_membership
        and a.decision is null and a.superseded_by is null
        and not exists (select 1 from public.approval_absences absence
          where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
            and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
    ) into v_can_decide;
  end if;
  return jsonb_build_object(
    'requestId', r.id,
    'status', r.status,
    'requiredApprovals', r.required_approvals,
    'configuredApprovals', v_configured_approvals,
    'approvedCount', v_approved,
    'pendingCount', v_pending,
    'rejectedCount', v_rejected,
    'currentUserDecision', v_decision,
    'canRequest', d.stage = 'ic_review'
      and app.has_permission(d.tenant_id, 'deal.request_approval')
      and exists (select 1 from public.approval_policies p where p.tenant_id = d.tenant_id)
      and (r.id is null or r.status <> 'pending'),
    'canDecide', coalesce(r.status = 'pending' and not v_is_requester
      and v_decision is null and v_can_decide and app.has_permission(d.tenant_id, 'approval.decide'), false),
    'canConfigure', app.has_permission(d.tenant_id, 'role.manage'),
    'canManageAbsence', app.has_permission(d.tenant_id, 'approval.decide'),
    'canReassign', coalesce(r.status = 'pending' and v_has_unavailable_approver
      and app.has_permission(d.tenant_id, 'member.manage'), false)
  );
end
$$;
revoke all on function public.deal_approval_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.deal_approval_status(uuid) to authenticated;

create function public.my_approval_absences(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_membership uuid;
  v_absences jsonb;
begin
  if p_tenant is null or p_tenant not in (select app.my_tenants()) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not app.has_permission(p_tenant, 'approval.decide') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = app.uid() and m.deactivated_at is null;
  if v_membership is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'active', a.starts_at <= now() and a.ends_at > now()
  ) order by a.starts_at), '[]'::jsonb)
    into v_absences from public.approval_absences a
    where a.tenant_id = p_tenant and a.membership_id = v_membership and a.cancelled_at is null
      and a.ends_at > now();
  return v_absences;
end
$$;
revoke all on function public.my_approval_absences(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_approval_absences(uuid) to authenticated;

create function public.approval_reassignment_options(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
  v_unavailable jsonb;
  v_replacements jsonb;
begin
  select * into r from public.approval_requests
    where id = p_request and tenant_id in (select app.my_tenants());
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  if not app.has_permission(r.tenant_id, 'member.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'membershipId', candidates.membership_id,
    'displayName', candidates.display_name
  ) order by candidates.display_name nulls last, candidates.membership_id), '[]'::jsonb)
    into v_unavailable from (
      select distinct a.membership_id, p.display_name
      from public.approval_request_approvers a
      join public.memberships m on m.tenant_id = a.tenant_id and m.id = a.membership_id
      left join public.profiles p on p.user_id = m.user_id
      where a.request_id = r.id and a.decision is null and a.superseded_by is null
        and (
          exists (select 1 from public.approval_absences absence
            where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
              and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
          or m.deactivated_at is not null
          or not exists (select 1 from public.membership_roles mr
            join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
            where mr.tenant_id = a.tenant_id and mr.membership_id = a.membership_id
              and rp.permission = 'approval.decide')
        )
    ) candidates;
  select coalesce(jsonb_agg(jsonb_build_object(
    'membershipId', candidates.membership_id,
    'displayName', candidates.display_name
  ) order by candidates.display_name nulls last, candidates.membership_id), '[]'::jsonb)
    into v_replacements from (
      select distinct m.id as membership_id, p.display_name
      from public.memberships m
      join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      left join public.profiles p on p.user_id = m.user_id
      where m.tenant_id = r.tenant_id and m.deactivated_at is null and m.id <> r.requested_by
        and rp.permission = 'approval.decide'
        and not exists (select 1 from public.approval_absences absence
          where absence.tenant_id = m.tenant_id and absence.membership_id = m.id
            and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
        and not exists (select 1 from public.membership_roles request_roles
          join public.role_permissions request_permissions
            on request_permissions.tenant_id = request_roles.tenant_id and request_permissions.role_id = request_roles.role_id
          where request_roles.tenant_id = m.tenant_id and request_roles.membership_id = m.id
            and request_permissions.permission = 'deal.request_approval')
        and not exists (select 1 from public.approval_request_approvers existing
          where existing.request_id = r.id and existing.membership_id = m.id)
    ) candidates;
  return jsonb_build_object('unavailableApprovers', v_unavailable, 'eligibleReplacements', v_replacements);
end
$$;
revoke all on function public.approval_reassignment_options(uuid) from public, anon, authenticated, service_role;
grant execute on function public.approval_reassignment_options(uuid) to authenticated;
