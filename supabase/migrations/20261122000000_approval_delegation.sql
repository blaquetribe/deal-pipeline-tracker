-- Feature 04: delegation is opt-in, time-bounded, and a proxy for an existing slot.
alter table public.approval_policies
  add column delegation_enabled boolean not null default false;

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  delegator_membership_id uuid not null,
  delegate_membership_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, delegator_membership_id) references public.memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, delegate_membership_id) references public.memberships (tenant_id, id) on delete restrict,
  foreign key (tenant_id, cancelled_by) references public.memberships (tenant_id, id) on delete restrict,
  check (delegator_membership_id <> delegate_membership_id),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '365 days'),
  check ((cancelled_at is null) = (cancelled_by is null))
);
create index approval_delegations_delegator_window_idx
  on public.approval_delegations (tenant_id, delegator_membership_id, starts_at, ends_at)
  where cancelled_at is null;
create index approval_delegations_delegate_window_idx
  on public.approval_delegations (tenant_id, delegate_membership_id, starts_at, ends_at)
  where cancelled_at is null;

alter table public.tenant_events drop constraint tenant_events_kind_check;
alter table public.tenant_events add constraint tenant_events_kind_check
  check (kind in ('tenant_created', 'role_granted', 'role_revoked', 'member_deactivated', 'ownership_transferred',
                  'settings_changed', 'invitation_sent', 'invitation_revoked', 'invitation_accepted',
                  'approval_absence_set', 'approval_absence_cancelled',
                  'approval_delegation_set', 'approval_delegation_cancelled'));

alter table public.approval_delegations enable row level security;
alter table public.approval_delegations force row level security;
create policy approval_delegations_select_participants on public.approval_delegations
  for select to authenticated using (
    delegator_membership_id in (select m.id from public.memberships m where m.user_id = (select app.uid()))
    or delegate_membership_id in (select m.id from public.memberships m where m.user_id = (select app.uid()))
    or (select app.has_permission(tenant_id, 'member.manage'))
  );
revoke all on public.approval_delegations from public, anon, authenticated, service_role;
grant select on public.approval_delegations to authenticated;

alter table public.approval_request_approvers add column decided_by_membership_id uuid;
update public.approval_request_approvers set decided_by_membership_id = membership_id where decision is not null;
alter table public.approval_request_approvers
  add constraint approval_request_approvers_decided_by_fk
    foreign key (tenant_id, decided_by_membership_id) references public.memberships (tenant_id, id) on delete restrict,
  add constraint approval_request_approvers_decided_by_check check (
    (decision is null and decided_by_membership_id is null)
    or (decision is not null and decided_by_membership_id is not null)
  );
create unique index approval_request_approvers_one_vote_per_actor_idx
  on public.approval_request_approvers (tenant_id, request_id, decided_by_membership_id)
  where decision is not null;

create function app.active_approval_delegate(p_tenant uuid, p_delegator uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.delegate_membership_id
  from public.approval_delegations d
  join public.approval_policies policy on policy.tenant_id = d.tenant_id and policy.delegation_enabled
  join public.memberships principal on principal.tenant_id = d.tenant_id and principal.id = d.delegator_membership_id
  join public.memberships delegate on delegate.tenant_id = d.tenant_id and delegate.id = d.delegate_membership_id
  where d.tenant_id = p_tenant and d.delegator_membership_id = p_delegator
    and d.cancelled_at is null and d.starts_at <= now() and d.ends_at > now()
    and principal.deactivated_at is null and delegate.deactivated_at is null
    and exists (select 1 from public.membership_roles mr
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where mr.tenant_id = p_tenant and mr.membership_id = p_delegator and rp.permission = 'approval.decide')
    and exists (select 1 from public.membership_roles mr
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where mr.tenant_id = p_tenant and mr.membership_id = d.delegate_membership_id and rp.permission = 'approval.decide')
    and not exists (select 1 from public.membership_roles mr
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where mr.tenant_id = p_tenant and mr.membership_id = d.delegate_membership_id
        and rp.permission in ('deal.request_approval', 'member.manage', 'role.manage'))
    and not exists (select 1 from public.approval_absences absence
      where absence.tenant_id = p_tenant and absence.membership_id = d.delegate_membership_id
        and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
  limit 1
$$;
revoke all on function app.active_approval_delegate(uuid, uuid) from public;

create function app.active_approval_principal(p_tenant uuid, p_delegate uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.delegator_membership_id from public.approval_delegations d
  where d.tenant_id = p_tenant and d.cancelled_at is null
    and d.starts_at <= now() and d.ends_at > now()
    and app.active_approval_delegate(p_tenant, d.delegator_membership_id) = p_delegate
  limit 1
$$;
revoke all on function app.active_approval_principal(uuid, uuid) from public;

create or replace function public.configure_approval_policy(p_tenant uuid, p_required_approvals integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_required_approvals is null or p_required_approvals not between 1 and 50 then
    raise exception 'invalid approval quorum' using errcode = '22023';
  end if;
  if not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.approval_policies (tenant_id, required_approvals)
    values (p_tenant, p_required_approvals)
  on conflict (tenant_id) do update set required_approvals = excluded.required_approvals, updated_at = now();
end
$$;
revoke all on function public.configure_approval_policy(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.configure_approval_policy(uuid, integer) to authenticated;

create function public.configure_approval_policy(p_tenant uuid, p_required_approvals integer, p_delegation_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current_enabled boolean;
begin
  if p_required_approvals is null or p_required_approvals not between 1 and 50 or p_delegation_enabled is null then
    raise exception 'invalid approval policy' using errcode = '22023';
  end if;
  if not app.has_permission(p_tenant, 'role.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select delegation_enabled into v_current_enabled from public.approval_policies where tenant_id = p_tenant for update;
  if v_current_enabled is distinct from p_delegation_enabled and exists (
    select 1 from public.approval_requests r where r.tenant_id = p_tenant and r.status = 'pending'
  ) then
    raise exception 'cannot change delegation while approvals are pending' using errcode = 'DP422';
  end if;
  insert into public.approval_policies (tenant_id, required_approvals, delegation_enabled)
    values (p_tenant, p_required_approvals, p_delegation_enabled)
  on conflict (tenant_id) do update set required_approvals = excluded.required_approvals,
    delegation_enabled = excluded.delegation_enabled, updated_at = now();
end
$$;
revoke all on function public.configure_approval_policy(uuid, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.configure_approval_policy(uuid, integer, boolean) to authenticated;

create function public.set_approval_delegation(
  p_tenant uuid, p_delegate uuid, p_starts_at timestamptz, p_ends_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_id uuid;
  v_delegation_enabled boolean;
begin
  if p_tenant is null or p_delegate is null or p_starts_at is null or p_ends_at is null
    or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '365 days' then
    raise exception 'invalid approval delegation window' using errcode = '22023';
  end if;
  if p_tenant not in (select app.my_tenants()) then raise exception 'permission denied' using errcode = '42501'; end if;
  select m.id into v_actor from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = app.uid() and m.deactivated_at is null;
  if v_actor is null or not app.has_permission(p_tenant, 'approval.decide') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select p.delegation_enabled into v_delegation_enabled from public.approval_policies p
    where p.tenant_id = p_tenant for update;
  if v_delegation_enabled is distinct from true then
    raise exception 'approval delegation is disabled' using errcode = 'DP422';
  end if;
  if exists (select 1 from public.approval_requests r where r.tenant_id = p_tenant and r.status = 'pending') then
    raise exception 'cannot change delegation while approvals are pending' using errcode = 'DP422';
  end if;
  perform 1 from public.memberships m
    where m.tenant_id = p_tenant and m.id in (v_actor, p_delegate) order by m.id for update;
  if p_delegate = v_actor or not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.id = p_delegate and m.deactivated_at is null
      and exists (select 1 from public.membership_roles mr join public.role_permissions rp
        on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = p_tenant and mr.membership_id = m.id and rp.permission = 'approval.decide')
      and not exists (select 1 from public.membership_roles mr join public.role_permissions rp
        on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
        where mr.tenant_id = p_tenant and mr.membership_id = m.id
          and rp.permission in ('deal.request_approval', 'member.manage', 'role.manage'))
  ) then
    raise exception 'delegate is not eligible' using errcode = 'DP422';
  end if;
  if exists (select 1 from public.approval_absences a
    where a.tenant_id = p_tenant and a.membership_id = p_delegate and a.cancelled_at is null
      and a.starts_at < p_ends_at and p_starts_at < a.ends_at) then
    raise exception 'delegate is unavailable during the delegation window' using errcode = 'DP422';
  end if;
  if exists (select 1 from public.approval_delegations d
    where d.tenant_id = p_tenant and d.cancelled_at is null
      and d.starts_at < p_ends_at and p_starts_at < d.ends_at
      and (d.delegator_membership_id in (v_actor, p_delegate)
        or d.delegate_membership_id in (v_actor, p_delegate))) then
    raise exception 'delegation overlaps an existing relationship' using errcode = 'DP422';
  end if;
  insert into public.approval_delegations
    (tenant_id, delegator_membership_id, delegate_membership_id, starts_at, ends_at)
    values (p_tenant, v_actor, p_delegate, p_starts_at, p_ends_at) returning id into v_id;
  insert into public.tenant_events (tenant_id, kind, subject_user_id, detail)
    values (p_tenant, 'approval_delegation_set', app.uid(),
      format('Approval delegation %s set for membership %s through %s', v_id, p_delegate, p_ends_at));
  return v_id;
end
$$;
revoke all on function public.set_approval_delegation(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.set_approval_delegation(uuid, uuid, timestamptz, timestamptz) to authenticated;

create function public.cancel_approval_delegation(p_delegation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.approval_delegations;
  v_actor uuid;
begin
  select m.id into v_actor from public.memberships m
    where m.user_id = app.uid() and m.deactivated_at is null
      and exists (select 1 from public.approval_delegations a where a.id = p_delegation
        and a.tenant_id = m.tenant_id and a.cancelled_at is null
        and m.id in (a.delegator_membership_id, a.delegate_membership_id));
  if v_actor is null then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into d from public.approval_delegations a where a.id = p_delegation
    and a.tenant_id in (select app.my_tenants()) and a.cancelled_at is null for update;
  if not found then raise exception 'approval delegation not found' using errcode = 'P0002'; end if;
  update public.approval_delegations set cancelled_at = now(), cancelled_by = v_actor where id = d.id;
  insert into public.tenant_events (tenant_id, kind, subject_user_id, detail)
    values (d.tenant_id, 'approval_delegation_cancelled', app.uid(),
      format('Approval delegation %s cancelled for membership %s', d.id, d.delegator_membership_id));
end
$$;
revoke all on function public.cancel_approval_delegation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_approval_delegation(uuid) to authenticated;

create function public.my_approval_delegations(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_rows jsonb;
begin
  if p_tenant is null or p_tenant not in (select app.my_tenants())
    or not app.has_permission(p_tenant, 'approval.decide') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select id into v_actor from public.memberships where tenant_id = p_tenant and user_id = app.uid() and deactivated_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'delegatorMembershipId', d.delegator_membership_id,
    'delegatorName', principal_profile.display_name, 'delegateMembershipId', d.delegate_membership_id,
    'delegateName', delegate_profile.display_name, 'startsAt', d.starts_at, 'endsAt', d.ends_at,
    'active', d.starts_at <= now() and d.ends_at > now(), 'canCancel', true
  ) order by d.starts_at), '[]'::jsonb)
  into v_rows from public.approval_delegations d
    join public.memberships principal on principal.tenant_id = d.tenant_id and principal.id = d.delegator_membership_id
    join public.profiles principal_profile on principal_profile.user_id = principal.user_id
    join public.memberships delegate on delegate.tenant_id = d.tenant_id and delegate.id = d.delegate_membership_id
    join public.profiles delegate_profile on delegate_profile.user_id = delegate.user_id
    where d.tenant_id = p_tenant and d.cancelled_at is null and d.ends_at > now()
      and v_actor in (d.delegator_membership_id, d.delegate_membership_id);
  return v_rows;
end
$$;
revoke all on function public.my_approval_delegations(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_approval_delegations(uuid) to authenticated;

create function public.eligible_approval_delegates(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_rows jsonb;
begin
  if p_tenant is null or p_tenant not in (select app.my_tenants())
    or not app.has_permission(p_tenant, 'approval.decide') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select id into v_actor from public.memberships where tenant_id = p_tenant and user_id = app.uid() and deactivated_at is null;
  if not exists (select 1 from public.approval_policies where tenant_id = p_tenant and delegation_enabled) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('membershipId', m.id, 'displayName', p.display_name)
    order by p.display_name, m.id), '[]'::jsonb)
    into v_rows from public.memberships m
    join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
    join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
    left join public.profiles p on p.user_id = m.user_id
    where m.tenant_id = p_tenant and m.deactivated_at is null and m.id <> v_actor
      and rp.permission = 'approval.decide'
      and not exists (select 1 from public.membership_roles other_mr
        join public.role_permissions other_rp on other_rp.tenant_id = other_mr.tenant_id and other_rp.role_id = other_mr.role_id
        where other_mr.tenant_id = p_tenant and other_mr.membership_id = m.id
          and other_rp.permission in ('deal.request_approval', 'member.manage', 'role.manage'))
      and not exists (select 1 from public.approval_absences a
        where a.tenant_id = p_tenant and a.membership_id = m.id and a.cancelled_at is null
          and a.starts_at <= now() and a.ends_at > now())
      and app.active_approval_principal(p_tenant, m.id) is null
      and app.active_approval_delegate(p_tenant, m.id) is null;
  return v_rows;
end
$$;
revoke all on function public.eligible_approval_delegates(uuid) from public, anon, authenticated, service_role;
grant execute on function public.eligible_approval_delegates(uuid) to authenticated;

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
  if not app.has_permission(d.tenant_id, 'deal.request_approval') then raise exception 'permission denied' using errcode = '42501'; end if;
  if d.archived_at is not null then raise exception 'deal is archived' using errcode = '55000'; end if;
  if d.version is distinct from p_expected_version then raise exception 'stale version' using errcode = 'DP409'; end if;
  if d.stage <> 'ic_review' then raise exception 'deal is not at IC review' using errcode = 'DP422'; end if;
  select p.required_approvals into v_policy from public.approval_policies p where p.tenant_id = d.tenant_id for update;
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
    and app.active_approval_principal(d.tenant_id, m.id) is null
    and app.active_approval_delegate(d.tenant_id, m.id) is distinct from v_requester
    and (not exists (select 1 from public.approval_absences a
      where a.tenant_id = m.tenant_id and a.membership_id = m.id and a.cancelled_at is null
        and a.starts_at <= now() and a.ends_at > now())
      or app.active_approval_delegate(d.tenant_id, m.id) is not null);
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
    and app.active_approval_principal(d.tenant_id, m.id) is null
    and app.active_approval_delegate(d.tenant_id, m.id) is distinct from v_requester
    and (not exists (select 1 from public.approval_absences a
      where a.tenant_id = m.tenant_id and a.membership_id = m.id and a.cancelled_at is null
        and a.starts_at <= now() and a.ends_at > now())
      or app.active_approval_delegate(d.tenant_id, m.id) is not null)
  group by m.id;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (d.tenant_id, d.id, 'approval_decision',
      format('Approval requested: %s of %s eligible approver slots', v_policy, v_eligible));
  return v_request;
end
$$;
revoke all on function public.request_approval(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.request_approval(uuid, integer) to authenticated;

create function public.decide_approval(
  p_request uuid, p_decision text, p_reason text, p_on_behalf_of uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.approval_requests;
  d public.deals;
  v_actor uuid;
  v_slot uuid;
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
  select * into r from public.approval_requests where id = p_request and tenant_id in (select app.my_tenants());
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  select * into d from public.deals where id = r.deal_id and tenant_id = r.tenant_id for update;
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  select * into r from public.approval_requests where id = p_request for update;
  if r.status <> 'pending' then raise exception 'approval request is not pending' using errcode = '55000'; end if;
  if not app.has_permission(r.tenant_id, 'approval.decide') then raise exception 'permission denied' using errcode = '42501'; end if;
  select m.id into v_actor from public.memberships m
    where m.tenant_id = r.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  if v_actor is null or v_actor = r.requested_by then raise exception 'permission denied' using errcode = '42501'; end if;
  v_slot := coalesce(p_on_behalf_of, v_actor);
  perform 1 from public.memberships m where m.tenant_id = r.tenant_id and m.id in (v_actor, v_slot)
    order by m.id for update;
  if p_on_behalf_of is not null and app.active_approval_delegate(r.tenant_id, v_slot) is distinct from v_actor then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_on_behalf_of is null and (app.active_approval_delegate(r.tenant_id, v_actor) is not null
    or app.active_approval_principal(r.tenant_id, v_actor) is not null) then
    raise exception 'delegate cannot cast a separate approval vote' using errcode = '42501';
  end if;
  if exists (select 1 from public.approval_absences absence
    where absence.tenant_id = r.tenant_id and absence.membership_id = v_actor
      and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()) then
    raise exception 'approver is absent' using errcode = 'DP422';
  end if;
  if exists (select 1 from public.approval_request_approvers a
    where a.tenant_id = r.tenant_id and a.request_id = r.id
      and a.decision is not null and a.decided_by_membership_id = v_actor) then
    raise exception 'approval decision already recorded' using errcode = '23505';
  end if;
  perform 1 from public.approval_request_approvers a
    where a.tenant_id = r.tenant_id and a.request_id = r.id and a.membership_id = v_slot
      and a.decision is null and a.superseded_by is null for update;
  if not found then raise exception 'permission denied' using errcode = '42501'; end if;
  if d.stage <> 'ic_review' then raise exception 'deal is not at IC review' using errcode = 'DP422'; end if;
  update public.approval_request_approvers set decision = p_decision,
    decision_reason = nullif(p_reason, ''), decided_at = now(), decided_by_membership_id = v_actor
    where tenant_id = r.tenant_id and request_id = r.id and membership_id = v_slot and superseded_by is null;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (r.tenant_id, r.deal_id, 'approval_decision',
      case when v_actor = v_slot then format('Approval %s%s', p_decision,
        case when nullif(p_reason, '') is not null then ': ' || p_reason else '' end)
      else format('Approval %s by delegate membership %s for membership %s%s', p_decision, v_actor, v_slot,
        case when nullif(p_reason, '') is not null then ': ' || p_reason else '' end) end);
  select count(*) filter (where a.decision = 'approve')::integer,
         count(*) filter (where a.decision is null and a.superseded_by is null
           and exists (select 1 from public.memberships m
             join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
             join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
             where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
               and rp.permission = 'approval.decide')
           and app.active_approval_delegate(a.tenant_id, a.membership_id) is distinct from r.requested_by
           and (app.active_approval_delegate(a.tenant_id, a.membership_id) is not null
             or not exists (select 1 from public.approval_absences absence
               where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
                 and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())))::integer
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
revoke all on function public.decide_approval(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.decide_approval(uuid, text, text, uuid) to authenticated;

create or replace function public.decide_approval(p_request uuid, p_decision text, p_reason text default null) returns text
language sql security definer set search_path = '' as $$
  select public.decide_approval(p_request, p_decision, p_reason, null::uuid)
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
  v_delegated_slots jsonb := '[]'::jsonb;
begin
  select * into d from public.deals where id = p_deal and tenant_id in (select app.my_tenants());
  if not found or not app.has_permission(d.tenant_id, 'deal.view') then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;
  select m.id into v_membership from public.memberships m
    where m.tenant_id = d.tenant_id and m.user_id = app.uid() and m.deactivated_at is null;
  select p.required_approvals into v_configured_approvals
    from public.approval_policies p where p.tenant_id = d.tenant_id;
  select * into r from public.approval_requests a where a.tenant_id = d.tenant_id and a.deal_id = d.id
    order by a.created_at desc, a.id desc limit 1;
  if found then
    select count(*) filter (where a.decision = 'approve')::integer,
           count(*) filter (where a.decision is null and a.superseded_by is null
             and exists (select 1 from public.memberships m
               join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
               join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
               where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
                 and rp.permission = 'approval.decide')
             and app.active_approval_delegate(a.tenant_id, a.membership_id) is distinct from r.requested_by
             and (app.active_approval_delegate(a.tenant_id, a.membership_id) is not null
               or not exists (select 1 from public.approval_absences absence
                 where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
                   and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())))::integer,
           count(*) filter (where a.decision = 'reject')::integer
      into v_approved, v_pending, v_rejected
      from public.approval_request_approvers a where a.request_id = r.id;
    v_is_requester := r.requested_by = v_membership;
    select a.decision into v_decision from public.approval_request_approvers a
      where a.request_id = r.id and a.decided_by_membership_id = v_membership;
    select exists (select 1 from public.approval_request_approvers a
      where a.request_id = r.id and a.membership_id = v_membership and a.decision is null and a.superseded_by is null
        and app.active_approval_delegate(a.tenant_id, a.membership_id) is null
        and not exists (select 1 from public.approval_absences absence
          where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
            and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()))
      into v_can_decide;
    select exists (select 1 from public.approval_request_approvers a
      where a.request_id = r.id and a.decision is null and a.superseded_by is null
        and (app.active_approval_delegate(a.tenant_id, a.membership_id) is not null
          or not exists (select 1 from public.memberships m
            join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
            join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
            where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
              and rp.permission = 'approval.decide'))
        and app.active_approval_delegate(a.tenant_id, a.membership_id) is null
        and exists (select 1 from public.approval_absences absence
          where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
            and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now()))
      into v_has_unavailable_approver;
    select coalesce(jsonb_agg(jsonb_build_object('membershipId', a.membership_id, 'displayName', p.display_name)
      order by p.display_name, a.membership_id), '[]'::jsonb)
      into v_delegated_slots
      from public.approval_request_approvers a
      left join public.memberships m on m.tenant_id = a.tenant_id and m.id = a.membership_id
      left join public.profiles p on p.user_id = m.user_id
      where a.request_id = r.id and a.decision is null and a.superseded_by is null
        and not v_is_requester and app.active_approval_delegate(a.tenant_id, a.membership_id) = v_membership;
  end if;
  return jsonb_build_object(
    'requestId', r.id, 'status', r.status, 'requiredApprovals', r.required_approvals,
    'configuredApprovals', v_configured_approvals, 'approvedCount', v_approved,
    'pendingCount', v_pending, 'rejectedCount', v_rejected, 'currentUserDecision', v_decision,
    'delegatedSlots', v_delegated_slots,
    'canRequest', d.stage = 'ic_review' and app.has_permission(d.tenant_id, 'deal.request_approval')
      and exists (select 1 from public.approval_policies p where p.tenant_id = d.tenant_id)
      and (r.id is null or r.status <> 'pending'),
    'canDecide', coalesce(r.status = 'pending' and not v_is_requester and v_decision is null
      and v_can_decide and app.has_permission(d.tenant_id, 'approval.decide'), false),
    'canConfigure', app.has_permission(d.tenant_id, 'role.manage'),
    'canManageAbsence', app.has_permission(d.tenant_id, 'approval.decide'),
    'canReassign', coalesce(r.status = 'pending' and v_has_unavailable_approver
      and app.has_permission(d.tenant_id, 'member.manage'), false)
  );
end
$$;
revoke all on function public.deal_approval_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.deal_approval_status(uuid) to authenticated;

create or replace function public.reassign_approval_approver(p_request uuid, p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.approval_requests;
  d public.deals;
  v_actor uuid;
begin
  select * into r from public.approval_requests where id = p_request and tenant_id in (select app.my_tenants());
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
      and (exists (select 1 from public.approval_absences absence
        where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
          and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
        or not exists (select 1 from public.memberships m
          join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
          join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
          where m.tenant_id = a.tenant_id and m.id = a.membership_id and m.deactivated_at is null
            and rp.permission = 'approval.decide')) for update;
  if not found then raise exception 'approver is not unavailable' using errcode = 'DP422'; end if;
  if p_to is null or p_to = r.requested_by or p_to = p_from
    or not exists (select 1 from public.memberships m
      join public.membership_roles mr on mr.tenant_id = m.tenant_id and mr.membership_id = m.id
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where m.tenant_id = r.tenant_id and m.id = p_to and m.deactivated_at is null
        and rp.permission = 'approval.decide')
    or exists (select 1 from public.membership_roles mr
      join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
      where mr.tenant_id = r.tenant_id and mr.membership_id = p_to and rp.permission = 'deal.request_approval')
    or exists (select 1 from public.approval_request_approvers a
      where a.request_id = r.id and a.membership_id = p_to)
    or exists (select 1 from public.approval_absences absence
      where absence.tenant_id = r.tenant_id and absence.membership_id = p_to
        and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
    or app.active_approval_delegate(r.tenant_id, p_to) is not null
    or app.active_approval_principal(r.tenant_id, p_to) is not null then
    raise exception 'replacement approver is not eligible' using errcode = 'DP422';
  end if;
  insert into public.approval_request_approvers (tenant_id, request_id, membership_id)
    values (r.tenant_id, r.id, p_to);
  update public.approval_request_approvers set superseded_by = p_to, superseded_at = now(), superseded_by_actor = v_actor
    where tenant_id = r.tenant_id and request_id = r.id and membership_id = p_from;
  insert into public.deal_events (tenant_id, deal_id, kind, body)
    values (r.tenant_id, r.deal_id, 'approval_decision',
      format('Approval approver reassigned: membership %s -> membership %s', p_from, p_to));
end
$$;
revoke all on function public.reassign_approval_approver(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reassign_approval_approver(uuid, uuid, uuid) to authenticated;

create or replace function public.approval_reassignment_options(p_request uuid) returns jsonb
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
    'membershipId', candidates.membership_id, 'displayName', candidates.display_name
  ) order by candidates.display_name nulls last, candidates.membership_id), '[]'::jsonb)
    into v_unavailable from (
      select distinct a.membership_id, p.display_name
      from public.approval_request_approvers a
      join public.memberships m on m.tenant_id = a.tenant_id and m.id = a.membership_id
      left join public.profiles p on p.user_id = m.user_id
      where a.request_id = r.id and a.decision is null and a.superseded_by is null
        and (exists (select 1 from public.approval_absences absence
          where absence.tenant_id = a.tenant_id and absence.membership_id = a.membership_id
            and absence.cancelled_at is null and absence.starts_at <= now() and absence.ends_at > now())
          or m.deactivated_at is not null
          or not exists (select 1 from public.membership_roles mr
            join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
            where mr.tenant_id = a.tenant_id and mr.membership_id = a.membership_id
              and rp.permission = 'approval.decide'))
    ) candidates;
  select coalesce(jsonb_agg(jsonb_build_object(
    'membershipId', candidates.membership_id, 'displayName', candidates.display_name
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
        and app.active_approval_delegate(r.tenant_id, m.id) is null
        and app.active_approval_principal(r.tenant_id, m.id) is null
    ) candidates;
  return jsonb_build_object('unavailableApprovers', v_unavailable, 'eligibleReplacements', v_replacements);
end
$$;
revoke all on function public.approval_reassignment_options(uuid) from public, anon, authenticated, service_role;
grant execute on function public.approval_reassignment_options(uuid) to authenticated;
