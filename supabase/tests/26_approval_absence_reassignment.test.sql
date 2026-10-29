-- Feature 04 follow-up: absences block approvals, and an Owner/Admin may reassign a
-- pending snapshot slot to another eligible member without erasing the original slot.
begin;
select plan(24);

select has_table('public', 'approval_absences', 'approval absences are stored per tenant membership');
select is((select count(*) from pg_class where oid = any(array[
  to_regclass('public.approval_absences')]) and relrowsecurity and relforcerowsecurity),
  1::bigint, 'absence data uses forced RLS');
select ok(
  not has_table_privilege('authenticated', 'public.approval_absences', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.approval_absences', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role', 'public.approval_absences', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'absence writes use narrow functions and anon/service_role have no direct write access');
select has_function('public', 'set_approval_absence', array['uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'a member can set their own absence window');
select has_function('public', 'reassign_approval_approver', array['uuid', 'uuid', 'uuid'],
  'an authorised member can reassign an approval slot');
select has_function('public', 'my_approval_absences', array['uuid'],
  'members can read their own absence windows');
select has_function('public', 'approval_reassignment_options', array['uuid'],
  'tenant administrators can read safe replacement choices');
select ok(
  has_function_privilege('authenticated', 'public.set_approval_absence(uuid,timestamptz,timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.reassign_approval_approver(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.my_approval_absences(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.approval_reassignment_options(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_approval_absence(uuid,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('public', 'public.reassign_approval_approver(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_approval_absences(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.approval_reassignment_options(uuid)', 'EXECUTE'),
  'absence and reassignment functions are not publicly executable');

insert into auth.users (id, instance_id, aud, role, email) values
  ('26262626-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-owner@example.test'),
  ('26262626-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-lead@example.test'),
  ('26262626-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-ic1@example.test'),
  ('26262626-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-ic2@example.test'),
  ('26262626-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-ic3@example.test'),
  ('26262626-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-ic4@example.test'),
  ('26262626-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-ic5@example.test'),
  ('26262626-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'absence-other-tenant@example.test');
insert into public.tenants (id, name) values
  ('26262626-0000-4000-8000-00000000000a', 'Absence tenant A'),
  ('26262626-0000-4000-8000-00000000000b', 'Absence tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  '26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-00000000000b');
insert into public.memberships (tenant_id, user_id) values
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000001'),
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000002'),
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000003'),
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000004'),
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000005'),
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000006'),
  ('26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000008'),
  ('26262626-0000-4000-8000-00000000000b', '26262626-0000-4000-8000-000000000007');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'owner'
where m.user_id in ('26262626-0000-4000-8000-000000000001', '26262626-0000-4000-8000-000000000007');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'deal_lead'
where m.user_id = '26262626-0000-4000-8000-000000000002';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'ic_member'
where m.user_id in ('26262626-0000-4000-8000-000000000003', '26262626-0000-4000-8000-000000000004',
  '26262626-0000-4000-8000-000000000005', '26262626-0000-4000-8000-000000000006');
insert into public.profiles (user_id, display_name) values
  ('26262626-0000-4000-8000-000000000001', 'Owner'),
  ('26262626-0000-4000-8000-000000000002', 'Deal Lead'),
  ('26262626-0000-4000-8000-000000000003', 'IC One'),
  ('26262626-0000-4000-8000-000000000004', 'IC Two'),
  ('26262626-0000-4000-8000-000000000005', 'IC Three'),
  ('26262626-0000-4000-8000-000000000006', 'IC Four'),
  ('26262626-0000-4000-8000-000000000008', 'IC Five');
create temporary table approval_absence_ids (key text primary key, id uuid);
grant all on approval_absence_ids to public;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.configure_approval_policy('26262626-0000-4000-8000-00000000000a', 2)$$,
  'Owner configures the tenant quorum');
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000002"}', true);
insert into approval_absence_ids values ('deal', public.create_deal(
  '26262626-0000-4000-8000-00000000000a', 'Approval with absence', 'Energy', 10000, 'ZAR', '2027-06-30'));
reset role;
update public.deals set stage = 'ic_review', version = 2 where id = (select id from approval_absence_ids where key = 'deal');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000002"}', true);
insert into approval_absence_ids values ('request', public.request_approval(
  (select id from approval_absence_ids where key = 'deal'), 2));
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000003"}', true);
insert into approval_absence_ids values ('absence', public.set_approval_absence(
  '26262626-0000-4000-8000-00000000000a', now() - interval '1 minute', now() + interval '1 day'));
select is(jsonb_array_length(public.my_approval_absences('26262626-0000-4000-8000-00000000000a')), 1,
  'a member can read their own active absence window');
select ok(
  (public.deal_approval_status((select id from approval_absence_ids where key = 'deal'))->>'canDecide')::boolean = false
  and (public.deal_approval_status((select id from approval_absence_ids where key = 'deal'))->>'pendingCount')::integer = 3,
  'absence disables the member action and removes that slot from reachable quorum');
select throws_ok(format($$select public.decide_approval(%L, 'approve', null)$$,
  (select id from approval_absence_ids where key = 'request')),
  'DP422', 'approver is absent', 'an absent approver cannot decide on an open request');
select is((select count(*) from public.approval_request_approvers
  where request_id = (select id from approval_absence_ids where key = 'request')
    and membership_id = (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000003')),
  1::bigint, 'absence does not erase the original approval snapshot');
select throws_ok(format($$select public.reassign_approval_approver(%L, %L, %L)$$,
  (select id from approval_absence_ids where key = 'request'),
  (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000003'),
  (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000006')),
  '42501', 'permission denied', 'a deal requester cannot reassign an approver');
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.grant_role(
  '26262626-0000-4000-8000-00000000000a', '26262626-0000-4000-8000-000000000008', 'ic_member')$$,
  'Owner adds an eligible IC member after the request snapshot');
select ok(
  (public.approval_reassignment_options((select id from approval_absence_ids where key = 'request'))
    ->'unavailableApprovers'->0->>'membershipId')::uuid =
      (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000003')
  and exists (select 1 from jsonb_array_elements(public.approval_reassignment_options(
    (select id from approval_absence_ids where key = 'request'))->'eligibleReplacements') option
    where option->>'membershipId' = (select id::text from public.memberships
      where user_id = '26262626-0000-4000-8000-000000000008')),
  'replacement options expose the absent slot and only eligible members');
select lives_ok(format($$select public.reassign_approval_approver(%L, %L, %L)$$,
  (select id from approval_absence_ids where key = 'request'),
  (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000003'),
  (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000008')),
  'Owner reassigns an absent slot to an active IC member');
select ok(exists (select 1 from public.approval_request_approvers a
  where a.request_id = (select id from approval_absence_ids where key = 'request')
    and a.membership_id = (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000003')
    and a.superseded_by = (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000008')),
  'reassignment preserves and links the original approver slot');
select ok(exists (select 1 from public.approval_request_approvers a
  where a.request_id = (select id from approval_absence_ids where key = 'request')
    and a.membership_id = (select id from public.memberships where user_id = '26262626-0000-4000-8000-000000000008')),
  'the replacement receives a new approval slot');
select ok(exists (select 1 from public.deal_events e
  where e.deal_id = (select id from approval_absence_ids where key = 'deal')
    and e.body like '%Approval approver reassigned%'),
  'reassignment is recorded in the append-only deal ledger');
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000008"}', true);
select is(public.decide_approval((select id from approval_absence_ids where key = 'request'), 'approve', null),
  'pending', 'the replacement can act on the assigned approval slot');
select throws_ok($$select public.set_approval_absence('26262626-0000-4000-8000-00000000000b', now(), now() + interval '1 day')$$,
  '42501', 'permission denied', 'a member cannot set an absence in another tenant');
select set_config('request.jwt.claims', '{"sub":"26262626-0000-4000-8000-000000000003"}', true);
select lives_ok(format($$select public.cancel_approval_absence(%L)$$,
  (select id from approval_absence_ids where key = 'absence')),
  'the absent member can cancel their own absence');
reset role;
select ok(exists (select 1 from public.tenant_events e
  where e.tenant_id = '26262626-0000-4000-8000-00000000000a'
    and e.kind = 'approval_absence_cancelled'
    and e.subject_user_id = '26262626-0000-4000-8000-000000000003'),
  'absence cancellation is recorded in the tenant audit trail');

select * from finish();
rollback;
