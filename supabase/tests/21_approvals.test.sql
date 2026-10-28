-- Feature 04, slice 1: approval policies, immutable requests and quorum decisions.
-- Authorization and maker-checker failures are written before the implementation.
begin;
select plan(30);

select has_table('public', 'approval_policies', 'tenant-scoped approval policies exist');
select has_table('public', 'approval_requests', 'approval requests exist');
select has_table('public', 'approval_request_approvers', 'eligible approvers are snapshotted');
select has_function('public', 'configure_approval_policy', array['uuid', 'integer'], 'policy configuration is a database function');
select has_function('public', 'request_approval', array['uuid', 'integer'], 'requests are submitted through a database function');
select has_function('public', 'decide_approval', array['uuid', 'text', 'text'], 'decisions are made through a database function');
select is((select count(*) from pg_class where oid = any(array[
  to_regclass('public.approval_policies'), to_regclass('public.approval_requests'),
  to_regclass('public.approval_request_approvers')]) and relrowsecurity and relforcerowsecurity),
  3::bigint, 'RLS is enabled and forced on every approval table');
select ok(
  not has_table_privilege('authenticated', 'public.approval_policies', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.approval_requests', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.approval_request_approvers', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.approval_requests', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'approval tables have no direct writes and anon has no access');
select ok(
  has_function_privilege('authenticated', 'public.configure_approval_policy(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.request_approval(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.decide_approval(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.configure_approval_policy(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.request_approval(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.decide_approval(uuid,text,text)', 'EXECUTE'),
  'approval functions are authenticated-only');

insert into auth.users (id, instance_id, aud, role, email) values
  ('21212121-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-owner@example.test'),
  ('21212121-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-lead@example.test'),
  ('21212121-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-ic1@example.test'),
  ('21212121-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-ic2@example.test'),
  ('21212121-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-ic3@example.test'),
  ('21212121-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'approval-admin@example.test');
insert into public.tenants (id, name) values
  ('21212121-0000-4000-8000-00000000000a', 'Approvals tenant A'),
  ('21212121-0000-4000-8000-00000000000b', 'Approvals tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  '21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-00000000000b');
insert into public.memberships (tenant_id, user_id) values
  ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-000000000001'),
  ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-000000000002'),
  ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-000000000003'),
  ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-000000000004'),
  ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-000000000005'),
  ('21212121-0000-4000-8000-00000000000a', '21212121-0000-4000-8000-000000000006'),
  ('21212121-0000-4000-8000-00000000000b', '21212121-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'owner' where m.user_id = '21212121-0000-4000-8000-000000000001';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'deal_lead' where m.user_id = '21212121-0000-4000-8000-000000000002';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'admin' where m.user_id = '21212121-0000-4000-8000-000000000006';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'ic_member'
where m.user_id in ('21212121-0000-4000-8000-000000000003', '21212121-0000-4000-8000-000000000004',
  '21212121-0000-4000-8000-000000000005');
create temporary table approval_test_ids (key text primary key, id uuid);
grant all on approval_test_ids to public;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.configure_approval_policy('21212121-0000-4000-8000-00000000000a', 2)$$,
  'Owner configures a two-approval IC gate using role.manage');
select throws_ok($$select public.configure_approval_policy('21212121-0000-4000-8000-00000000000b', 1)$$,
  '42501', 'permission denied', 'policy cannot be configured across tenants');
select throws_ok($$select public.configure_approval_policy('21212121-0000-4000-8000-00000000000a', 0)$$,
  '22023', 'invalid approval quorum', 'quorum must be positive');
select throws_ok($$select public.configure_approval_policy('21212121-0000-4000-8000-00000000000a', 51)$$,
  '22023', 'invalid approval quorum', 'quorum is bounded at the database boundary');

select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000002"}', true);
insert into approval_test_ids values ('deal-approved', public.create_deal(
  '21212121-0000-4000-8000-00000000000a', 'IC approval deal', 'Energy', 10000, 'ZAR', '2027-06-30'));
select throws_ok(format($$select public.request_approval(%L, 1)$$, (select id from approval_test_ids where key = 'deal-approved')),
  'DP422', 'deal is not at IC review', 'request cannot bypass the stage gate');
reset role;
update public.deals set stage = 'ic_review', version = 2 where id = (select id from approval_test_ids where key = 'deal-approved');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000002"}', true);
select throws_ok(format($$select public.request_approval(%L, 1)$$, (select id from approval_test_ids where key = 'deal-approved')),
  'DP409', 'stale version', 'request rejects a stale deal version');
insert into approval_test_ids values ('request-approved', public.request_approval(
  (select id from approval_test_ids where key = 'deal-approved'), 2));
select is((select count(*) from public.approval_request_approvers where request_id =
  (select id from approval_test_ids where key = 'request-approved')), 3::bigint,
  'request snapshots all three eligible IC approvers');
select throws_ok(format($$select public.decide_approval(%L, 'approve', null)$$,
  (select id from approval_test_ids where key = 'request-approved')),
  '42501', 'permission denied', 'requester cannot approve own request');
select throws_ok($$select public.request_approval('21212121-0000-4000-8000-00000000000b', 1)$$,
  'P0002', 'deal not found', 'requester cannot discover another tenant deal');

select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000006"}', true);
select throws_ok(format($$select public.decide_approval(%L, 'approve', null)$$,
  (select id from approval_test_ids where key = 'request-approved')),
  '42501', 'permission denied', 'Admin cannot decide a pending approval');

select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000003"}', true);
select is(public.decide_approval((select id from approval_test_ids where key = 'request-approved'), 'approve', null),
  'pending', 'first approval does not satisfy a 2-of-3 quorum');
select throws_ok(format($$select public.decide_approval(%L, 'approve', null)$$,
  (select id from approval_test_ids where key = 'request-approved')),
  '23505', 'approval decision already recorded', 'one approver cannot decide twice');
select throws_ok(format($$select public.decide_approval(%L, 'abstain', null)$$,
  (select id from approval_test_ids where key = 'request-approved')),
  '22023', 'decision must be approve or reject', 'abstention is not a decision');

select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000004"}', true);
select is(public.decide_approval((select id from approval_test_ids where key = 'request-approved'), 'approve', null),
  'approved', 'quorum approval succeeds the request');
select is((select stage from public.deals where id = (select id from approval_test_ids where key = 'deal-approved')),
  'signed', 'quorum completion moves the deal to signed atomically');
select is((select count(*) from public.deal_events where deal_id =
  (select id from approval_test_ids where key = 'deal-approved') and kind = 'approval_decision'),
  3::bigint, 'request and each decision are recorded in the immutable ledger');
select throws_ok(format($$select public.decide_approval(%L, 'approve', null)$$,
  (select id from approval_test_ids where key = 'request-approved')),
  '55000', 'approval request is not pending', 'completed requests cannot be decided again');

select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000002"}', true);
insert into approval_test_ids values ('deal-rejected', public.create_deal(
  '21212121-0000-4000-8000-00000000000a', 'IC rejected deal', 'Energy', 10000, 'ZAR', '2027-06-30'));
reset role;
update public.deals set stage = 'ic_review', version = 2 where id = (select id from approval_test_ids where key = 'deal-rejected');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000005"}', true);
-- This IC member cannot start an approval request.
select throws_ok(format($$select public.request_approval(%L, 2)$$, (select id from approval_test_ids where key = 'deal-rejected')),
  '42501', 'permission denied', 'IC member cannot request approval');
select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000002"}', true);
insert into approval_test_ids values ('request-rejected', public.request_approval(
  (select id from approval_test_ids where key = 'deal-rejected'), 2));
select throws_ok(format($$select public.move_stage(%L, 'due_diligence', 2)$$,
  (select id from approval_test_ids where key = 'deal-rejected')),
  'DP422', 'approval request is pending', 'a deal cannot leave IC review while its request is pending');
select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000003"}', true);
select is(public.decide_approval((select id from approval_test_ids where key = 'request-rejected'), 'reject', 'Insufficient diligence'),
  'pending', 'one rejection does not fail a 2-of-3 quorum while it remains reachable');
select set_config('request.jwt.claims', '{"sub":"21212121-0000-4000-8000-000000000004"}', true);
select is(public.decide_approval((select id from approval_test_ids where key = 'request-rejected'), 'reject', null),
  'rejected', 'rejections fail once the remaining approvers cannot reach quorum');
reset role;

select * from finish();
rollback;
