-- Feature 04, slice 1: expose only the caller's actionable approval state for a visible deal.
create function public.deal_approval_status(p_deal uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = ''
as $$
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
           count(*) filter (where a.decision is null)::integer,
           count(*) filter (where a.decision = 'reject')::integer
      into v_approved, v_pending, v_rejected
      from public.approval_request_approvers a where a.request_id = r.id;
    v_is_requester := r.requested_by = v_membership;
    select a.decision into v_decision from public.approval_request_approvers a
      where a.request_id = r.id and a.membership_id = v_membership;
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
      and v_decision is null and app.has_permission(d.tenant_id, 'approval.decide'), false),
    'canConfigure', app.has_permission(d.tenant_id, 'role.manage')
  );
end
$$;
revoke all on function public.deal_approval_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.deal_approval_status(uuid) to authenticated;
