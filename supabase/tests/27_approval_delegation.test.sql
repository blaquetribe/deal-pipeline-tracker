-- Feature 04: tenant-scoped, opt-in approval delegation preserves the original slot
-- and records the acting delegate without granting a second vote.
begin;
select plan(43);

select has_table('public', 'approval_delegations', 'approval delegations are stored per tenant');
select is((select count(*) from pg_class where oid = to_regclass('public.approval_delegations')
  and relrowsecurity and relforcerowsecurity), 1::bigint, 'delegation data uses forced RLS');
select ok(
  not has_table_privilege('authenticated', 'public.approval_delegations', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.approval_delegations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.approval_delegations', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'delegation writes use narrow functions and direct writes are revoked');
select has_function('public', 'set_approval_delegation', array['uuid', 'uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'members configure their own approval delegation');
select has_function('public', 'cancel_approval_delegation', array['uuid'],
  'delegator or delegate can revoke a delegation');
select has_function('public', 'my_approval_delegations', array['uuid'],
  'members can list their own approval delegations');
select has_function('public', 'eligible_approval_delegates', array['uuid'],
  'members can read eligible delegation choices');
select has_function('public', 'scan_approval_quorum_alerts', array['timestamp with time zone'],
  'scheduled scanner creates quorum reachability alerts');
select has_function('public', 'scan_approval_sla_escalations', array['timestamp with time zone'],
  'scheduled scanner creates overdue IC approval alerts');
select has_function('public', 'get_approval_policy', array['uuid'],
  'tenant approval policy has an authenticated read function');
select has_function('public', 'decide_approval', array['uuid', 'text', 'text', 'uuid'],
  'a delegate selects the original approver slot explicitly');
select ok(
  has_function_privilege('authenticated', 'public.set_approval_delegation(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_approval_delegation(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.my_approval_delegations(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.eligible_approval_delegates(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.configure_approval_policy(uuid,integer,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_approval_delegation(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('public', 'public.cancel_approval_delegation(uuid)', 'EXECUTE'),
  'delegation functions are authenticated-only');

insert into auth.users (id, instance_id, aud, role, email) values
  ('31313131-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delegation-owner@example.test'),
  ('31313131-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delegation-lead@example.test'),
  ('31313131-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delegation-ic1@example.test'),
  ('31313131-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delegation-ic2@example.test'),
  ('31313131-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'delegation-ic3@example.test'),
  ('31313131-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'delegation-ic4@example.test'),
  ('31313131-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'delegation-other@example.test');
insert into public.tenants (id, name) values
  ('31313131-0000-4000-8000-00000000000a', 'Delegation tenant A'),
  ('31313131-0000-4000-8000-00000000000b', 'Delegation tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  '31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-00000000000b');
insert into public.memberships (tenant_id, user_id) values
  ('31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-000000000001'),
  ('31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-000000000002'),
  ('31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-000000000003'),
  ('31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-000000000004'),
  ('31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-000000000005'),
  ('31313131-0000-4000-8000-00000000000a', '31313131-0000-4000-8000-000000000006'),
  ('31313131-0000-4000-8000-00000000000b', '31313131-0000-4000-8000-000000000007');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'owner'
where m.user_id in ('31313131-0000-4000-8000-000000000001', '31313131-0000-4000-8000-000000000007');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'deal_lead'
where m.user_id = '31313131-0000-4000-8000-000000000002';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'ic_member'
where m.user_id in ('31313131-0000-4000-8000-000000000003', '31313131-0000-4000-8000-000000000004',
  '31313131-0000-4000-8000-000000000005', '31313131-0000-4000-8000-000000000006');
insert into public.profiles (user_id, display_name) values
  ('31313131-0000-4000-8000-000000000001', 'Owner'),
  ('31313131-0000-4000-8000-000000000002', 'Lead'),
  ('31313131-0000-4000-8000-000000000003', 'IC One'),
  ('31313131-0000-4000-8000-000000000004', 'IC Two'),
  ('31313131-0000-4000-8000-000000000005', 'IC Three'),
  ('31313131-0000-4000-8000-000000000006', 'IC Four');
create temporary table approval_delegation_ids (key text primary key, id uuid);
grant all on approval_delegation_ids to public;
insert into approval_delegation_ids
select 'ic-one', id from public.memberships where user_id = '31313131-0000-4000-8000-000000000003';
insert into approval_delegation_ids
select 'ic-four', id from public.memberships where user_id = '31313131-0000-4000-8000-000000000006';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.configure_approval_policy('31313131-0000-4000-8000-00000000000a', 2)$$,
  'legacy policy configuration leaves delegation disabled');
select is((select delegation_enabled from public.approval_policies
  where tenant_id = '31313131-0000-4000-8000-00000000000a'), false,
  'delegation is disabled by default');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000003"}', true);
select throws_ok(format($$select public.set_approval_delegation('31313131-0000-4000-8000-00000000000a', %L, now(), now() + interval '1 day')$$,
  (select id from approval_delegation_ids where key = 'ic-four')),
  'DP422', 'approval delegation is disabled', 'a member cannot delegate while the tenant setting is off');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.configure_approval_policy('31313131-0000-4000-8000-00000000000a', 2, true)$$,
  'Owner explicitly enables delegation');
select is(public.get_approval_policy('31313131-0000-4000-8000-00000000000a'),
  '{"requiredApprovals": 2, "delegationEnabled": true}'::jsonb,
  'Owner can read the configured quorum and delegation setting');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000003"}', true);
select throws_ok($$select public.get_approval_policy('31313131-0000-4000-8000-00000000000a')$$,
  '42501', 'permission denied', 'approval policy read is restricted to role managers');
insert into approval_delegation_ids values ('delegation', public.set_approval_delegation(
  '31313131-0000-4000-8000-00000000000a',
  (select id from approval_delegation_ids where key = 'ic-four'), now() - interval '1 minute', now() + interval '1 day'));
select is(jsonb_array_length(public.my_approval_delegations('31313131-0000-4000-8000-00000000000a')), 1,
  'a delegator can read their own delegation');
select throws_ok($$select public.my_approval_delegations('31313131-0000-4000-8000-00000000000b')$$,
  '42501', 'permission denied', 'delegation reads cannot cross tenants');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000002"}', true);
insert into approval_delegation_ids values ('deal', public.create_deal(
  '31313131-0000-4000-8000-00000000000a', 'Delegated approval', 'Energy', 10000, 'ZAR', '2027-06-30'));
reset role;
update public.deals set stage = 'ic_review', version = 2
  where id = (select id from approval_delegation_ids where key = 'deal');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000002"}', true);
insert into approval_delegation_ids values ('request', public.request_approval(
  (select id from approval_delegation_ids where key = 'deal'), 2));
select ok(
  exists (select 1 from public.approval_request_approvers a
    where a.request_id = (select id from approval_delegation_ids where key = 'request')
      and a.membership_id = (select id from approval_delegation_ids where key = 'ic-one'))
  and not exists (select 1 from public.approval_request_approvers a
    where a.request_id = (select id from approval_delegation_ids where key = 'request')
      and a.membership_id = (select id from approval_delegation_ids where key = 'ic-four')),
  'request snapshot keeps the original slot and omits the proxy own slot');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000001"}', true);
select ok(not exists (
  select 1 from jsonb_array_elements(public.approval_reassignment_options(
    (select id from approval_delegation_ids where key = 'request'))->'eligibleReplacements') candidate
  where candidate->>'membershipId' = (select id::text from approval_delegation_ids where key = 'ic-four')
), 'a delegate is not offered as a reassignment target');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000006"}', true);
select ok(not (public.deal_approval_status((select id from approval_delegation_ids where key = 'deal'))->>'canDecide')::boolean
  and (public.deal_approval_status((select id from approval_delegation_ids where key = 'deal'))
    ->'delegatedSlots'->0->>'membershipId')::uuid = (select id from approval_delegation_ids where key = 'ic-one'),
  'delegate status exposes the assigned slot without enabling the cut-list UI');
select is(public.decide_approval((select id from approval_delegation_ids where key = 'request'), 'approve', null,
  (select id from approval_delegation_ids where key = 'ic-one')),
  'pending', 'delegate records a decision for the original approver slot');
select throws_ok(format($$select public.decide_approval(%L, 'approve', null)$$,
  (select id from approval_delegation_ids where key = 'request')),
  '42501', 'delegate cannot cast a separate approval vote', 'delegate cannot vote again using their own membership');
select ok(exists (select 1 from public.approval_request_approvers a
  where a.request_id = (select id from approval_delegation_ids where key = 'request')
    and a.membership_id = (select id from approval_delegation_ids where key = 'ic-one')
    and a.decision = 'approve'
    and a.decided_by_membership_id = (select id from approval_delegation_ids where key = 'ic-four')),
  'original slot records the delegate as decision actor');
select throws_ok(format($$select public.decide_approval(%L, 'approve', null, %L)$$,
  (select id from approval_delegation_ids where key = 'request'),
  (select id from approval_delegation_ids where key = 'ic-one')),
  '23505', 'approval decision already recorded', 'delegate cannot cast another vote for the same request');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000001"}', true);
select throws_ok($$select public.configure_approval_policy('31313131-0000-4000-8000-00000000000a', 2, false)$$,
  'DP422', 'cannot change delegation while approvals are pending', 'Owner cannot disable delegation mid-request');
select set_config('request.jwt.claims', '{"sub":"31313131-0000-4000-8000-000000000006"}', true);
select lives_ok(format($$select public.cancel_approval_delegation(%L)$$,
  (select id from approval_delegation_ids where key = 'delegation')),
  'a delegate can revoke the delegation');
reset role;
select ok(exists (select 1 from public.tenant_events e
  where e.tenant_id = '31313131-0000-4000-8000-00000000000a'
    and e.kind = 'approval_delegation_cancelled'
    and e.subject_user_id = '31313131-0000-4000-8000-000000000006'),
  'delegation revocation is recorded in the tenant audit trail');

update public.memberships set deactivated_at = now()
where user_id in ('31313131-0000-4000-8000-000000000004', '31313131-0000-4000-8000-000000000005');
select is(public.scan_approval_quorum_alerts(now()), 2,
  'unreachable approval quorum alerts the request creator and tenant owner');
select is(public.scan_approval_quorum_alerts(now()), 0,
  'repeated quorum scans do not duplicate recipient alerts');
select ok(not has_function_privilege('authenticated', 'public.scan_approval_quorum_alerts(timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.scan_approval_quorum_alerts(timestamptz)', 'EXECUTE'),
  'quorum scanner is not callable by application roles');
select ok(has_function_privilege('authenticated', 'public.get_approval_policy(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_approval_policy(uuid)', 'EXECUTE'),
  'approval policy read is authenticated-only');
select is((select count(*) from public.notifications
  where tenant_id = '31313131-0000-4000-8000-00000000000a'
    and kind = 'approval_quorum_unreachable'), 2::bigint,
  'quorum notifications stay within the originating tenant');
select ok(not has_function_privilege('public', 'public.scan_approval_sla_escalations(timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.scan_approval_sla_escalations(timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.scan_approval_sla_escalations(timestamptz)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.scan_approval_sla_escalations(timestamptz)', 'EXECUTE'),
  'SLA escalation scanner is not callable by application roles');
select ok(exists (select 1 from cron.job where jobname = 'scan-approval-sla-hourly'),
  'SLA escalation runs from the database scheduler');
update public.memberships set deactivated_at = null
where user_id = '31313131-0000-4000-8000-000000000004';
update public.approval_requests set created_at = '2026-10-01 12:00:00+00'
where id = (select id from approval_delegation_ids where key = 'request');
select is(public.scan_approval_sla_escalations('2026-10-02 11:59:59.999999+00'), 0,
  'approval is not escalated before its 24-hour SLA');
select is(public.scan_approval_sla_escalations('2026-10-02 12:00:00+00'), 3,
  'overdue request escalates to its pending approver, requester, and tenant owner');
select is(public.scan_approval_sla_escalations('2026-10-03 12:00:00+00'), 0,
  'repeated hourly scans do not duplicate an escalation');
select is((select count(*) from public.notifications
  where tenant_id = '31313131-0000-4000-8000-00000000000a'
    and kind = 'approval_sla_escalation'), 3::bigint,
  'SLA notifications stay within the originating tenant');
select ok(exists (select 1 from public.notifications n
  join public.memberships m on m.tenant_id = n.tenant_id and m.user_id = n.user_id
  where n.tenant_id = '31313131-0000-4000-8000-00000000000a'
    and n.kind = 'approval_sla_escalation'
    and m.user_id = '31313131-0000-4000-8000-000000000004'),
  'an active member with an undecided approval slot receives the SLA escalation');
select is((select payload->>'message' from public.notifications
  where tenant_id = '31313131-0000-4000-8000-00000000000a'
    and kind = 'approval_sla_escalation' limit 1),
  'IC approval has been waiting for more than 24 hours.',
  'escalation explains the overdue state without changing the approval');

select * from finish();
rollback;
