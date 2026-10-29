-- Feature 04: one-time notification when an IC request remains pending for 24 hours.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('closing_soon', 'approval_quorum_unreachable', 'approval_sla_escalation'));

create function public.scan_approval_sla_escalations(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_recipient uuid;
  v_inserted integer;
  v_total integer := 0;
  v_payload jsonb;
begin
  if p_now is null then raise exception 'scan time is required' using errcode = '22004'; end if;

  for r in
    select request.id, request.tenant_id, request.deal_id, request.requested_by, request.created_at,
      deal.name
    from public.approval_requests request
    join public.deals deal on deal.tenant_id = request.tenant_id and deal.id = request.deal_id
    where request.status = 'pending' and request.created_at <= p_now - interval '24 hours'
      and deal.archived_at is null
    order by request.created_at, request.id
    for update of request skip locked
  loop
    v_payload := jsonb_build_object('dealId', r.deal_id, 'dealName', r.name,
      'message', 'IC approval has been waiting for more than 24 hours.',
      'href', '/deals/' || r.deal_id::text);

    for v_recipient in
      select distinct member.user_id
      from public.memberships member
      where member.tenant_id = r.tenant_id and member.deactivated_at is null
        and (member.id = r.requested_by or exists (
          select 1 from public.membership_roles mr
          join public.roles role on role.tenant_id = mr.tenant_id and role.id = mr.role_id
          where mr.tenant_id = member.tenant_id and mr.membership_id = member.id
            and role.key in ('owner', 'admin')
        ))
      union
      select member.user_id
      from public.approval_request_approvers slot
      join public.memberships member on member.tenant_id = slot.tenant_id
        and member.id = slot.membership_id
      where slot.request_id = r.id and slot.decision is null and slot.superseded_by is null
        and member.deactivated_at is null
        and exists (
          select 1 from public.membership_roles mr
          join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
          where mr.tenant_id = member.tenant_id and mr.membership_id = member.id
            and rp.permission = 'approval.decide'
        )
        and not exists (
          select 1 from public.approval_absences absence
          where absence.tenant_id = member.tenant_id and absence.membership_id = member.id
            and absence.cancelled_at is null and absence.starts_at <= p_now and absence.ends_at > p_now
        )
      union
      select delegate.user_id
      from public.approval_request_approvers slot
      join public.approval_delegations delegation on delegation.tenant_id = slot.tenant_id
        and delegation.delegator_membership_id = slot.membership_id
      join public.approval_policies policy on policy.tenant_id = delegation.tenant_id
        and policy.delegation_enabled
      join public.memberships principal on principal.tenant_id = delegation.tenant_id
        and principal.id = delegation.delegator_membership_id
      join public.memberships delegate on delegate.tenant_id = delegation.tenant_id
        and delegate.id = delegation.delegate_membership_id
      where slot.request_id = r.id and slot.decision is null and slot.superseded_by is null
        and delegation.cancelled_at is null and delegation.starts_at <= p_now and delegation.ends_at > p_now
        and principal.deactivated_at is null and delegate.deactivated_at is null
        and delegate.id <> r.requested_by
        and exists (
          select 1 from public.membership_roles mr
          join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
          where mr.tenant_id = delegate.tenant_id and mr.membership_id = delegate.id
            and rp.permission = 'approval.decide'
        )
        and not exists (
          select 1 from public.approval_absences absence
          where absence.tenant_id = delegate.tenant_id and absence.membership_id = delegate.id
            and absence.cancelled_at is null and absence.starts_at <= p_now and absence.ends_at > p_now
        )
        and not exists (
          select 1 from public.membership_roles mr
          join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
          where mr.tenant_id = delegate.tenant_id and mr.membership_id = delegate.id
            and rp.permission in ('deal.request_approval', 'member.manage', 'role.manage')
        )
        and not exists (
          select 1 from public.approval_request_approvers prior
          where prior.request_id = slot.request_id and prior.decision is not null
            and prior.decided_by_membership_id = delegate.id
        )
    loop
      insert into public.notifications (tenant_id, user_id, kind, deal_id, dedupe_key, payload)
      values (r.tenant_id, v_recipient, 'approval_sla_escalation', r.deal_id,
        'approval-sla-escalation:' || r.id::text || ':' || v_recipient::text, v_payload)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_inserted = row_count;
      v_total := v_total + v_inserted;
    end loop;
  end loop;
  return v_total;
end
$$;
revoke all on function public.scan_approval_sla_escalations(timestamptz)
  from public, anon, authenticated, service_role;

select cron.schedule('scan-approval-sla-hourly', '0 * * * *',
  $$select public.scan_approval_sla_escalations(now())$$)
where not exists (select 1 from cron.job where jobname = 'scan-approval-sla-hourly');
