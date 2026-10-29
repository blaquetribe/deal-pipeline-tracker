-- Feature 04: notify request owners and tenant admins when quorum is unreachable.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('closing_soon', 'approval_quorum_unreachable'));

create function public.scan_approval_quorum_alerts(p_now timestamptz default now()) returns integer
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
    select request.id, request.tenant_id, request.deal_id, request.requested_by,
      request.required_approvals, deal.name
    from public.approval_requests request
    join public.deals deal on deal.tenant_id = request.tenant_id and deal.id = request.deal_id
    where request.status = 'pending' and deal.archived_at is null
    order by request.created_at, request.id
    for update of request skip locked
  loop
    if (
      select count(*) filter (where slot.decision = 'approve')
        + count(*) filter (where slot.decision is null and slot.superseded_by is null
          and (
            (exists (select 1 from public.memberships member
              join public.membership_roles mr on mr.tenant_id = member.tenant_id and mr.membership_id = member.id
              join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
              where member.tenant_id = slot.tenant_id and member.id = slot.membership_id
                and member.deactivated_at is null and rp.permission = 'approval.decide')
             and not exists (select 1 from public.approval_absences absence
               where absence.tenant_id = slot.tenant_id and absence.membership_id = slot.membership_id
                 and absence.cancelled_at is null and absence.starts_at <= p_now and absence.ends_at > p_now))
            or exists (select 1 from public.memberships delegate
              join public.approval_delegations delegation on delegation.tenant_id = delegate.tenant_id
                and delegation.delegate_membership_id = delegate.id
              join public.approval_policies policy on policy.tenant_id = delegation.tenant_id
                and policy.delegation_enabled
              join public.memberships principal on principal.tenant_id = delegation.tenant_id
                and principal.id = delegation.delegator_membership_id
              join public.membership_roles mr on mr.tenant_id = delegate.tenant_id and mr.membership_id = delegate.id
              join public.role_permissions rp on rp.tenant_id = mr.tenant_id and rp.role_id = mr.role_id
              where delegation.tenant_id = slot.tenant_id and delegation.delegator_membership_id = slot.membership_id
                and delegation.cancelled_at is null and delegation.starts_at <= p_now and delegation.ends_at > p_now
                and delegate.deactivated_at is null and principal.deactivated_at is null
                and delegate.id <> r.requested_by
                and rp.permission = 'approval.decide'
                and not exists (select 1 from public.approval_absences absence
                  where absence.tenant_id = delegate.tenant_id and absence.membership_id = delegate.id
                    and absence.cancelled_at is null and absence.starts_at <= p_now and absence.ends_at > p_now)
                and not exists (select 1 from public.membership_roles conflict_mr
                  join public.role_permissions conflict_rp on conflict_rp.tenant_id = conflict_mr.tenant_id
                    and conflict_rp.role_id = conflict_mr.role_id
                  where conflict_mr.tenant_id = delegate.tenant_id and conflict_mr.membership_id = delegate.id
                    and conflict_rp.permission in ('deal.request_approval', 'member.manage', 'role.manage'))
                and not exists (select 1 from public.approval_request_approvers prior
                  where prior.request_id = slot.request_id and prior.decision is not null
                    and prior.decided_by_membership_id = delegate.id)
            )
          ))
      from public.approval_request_approvers slot where slot.request_id = r.id
    ) >= r.required_approvals then continue; end if;

    v_payload := jsonb_build_object('dealId', r.deal_id, 'dealName', r.name,
      'message', 'Approval quorum can no longer be reached.', 'href', '/deals/' || r.deal_id::text);

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
    loop
      insert into public.notifications (tenant_id, user_id, kind, deal_id, dedupe_key, payload)
      values (r.tenant_id, v_recipient, 'approval_quorum_unreachable', r.deal_id,
        'approval-quorum-unreachable:' || r.id::text || ':' || v_recipient::text, v_payload)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_inserted = row_count;
      v_total := v_total + v_inserted;
    end loop;
  end loop;
  return v_total;
end
$$;
revoke all on function public.scan_approval_quorum_alerts(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('scan-approval-quorum-hourly', '0 * * * *',
  $$select public.scan_approval_quorum_alerts(now())$$)
where not exists (select 1 from cron.job where jobname = 'scan-approval-quorum-hourly');
