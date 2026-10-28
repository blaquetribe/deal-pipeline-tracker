-- Feature 04, slice 1: the status RPC is tenant-scoped and exposes only actionable caller state.
begin;
select plan(12);
select has_function('public', 'deal_approval_status', array['uuid'], 'approval status RPC exists');
select ok(has_function_privilege('authenticated', 'public.deal_approval_status(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.deal_approval_status(uuid)', 'EXECUTE'),
  'only authenticated users can call approval status');

insert into auth.users (id, instance_id, aud, role, email) values
  ('22222222-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'status-owner@example.test'),
  ('22222222-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'status-lead@example.test'),
  ('22222222-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'status-ic@example.test'),
  ('22222222-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'status-other@example.test'),
  ('22222222-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'status-unassigned@example.test');
insert into public.tenants (id, name) values
  ('22222222-0000-4000-8000-00000000000a', 'Status tenant A'),
  ('22222222-0000-4000-8000-00000000000b', 'Status tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  '22222222-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-00000000000b');
insert into public.memberships (tenant_id, user_id) values
  ('22222222-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000003'),
  ('22222222-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-000000000005'),
  ('22222222-0000-4000-8000-00000000000b', '22222222-0000-4000-8000-000000000004');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'owner' where m.user_id = '22222222-0000-4000-8000-000000000001';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'deal_lead' where m.user_id = '22222222-0000-4000-8000-000000000002';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = 'ic_member' where m.user_id = '22222222-0000-4000-8000-000000000003';
create temporary table status_ids (name text primary key, id uuid);
grant all on status_ids to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000002"}', true);
insert into status_ids values ('deal', public.create_deal(
  '22222222-0000-4000-8000-00000000000a', 'Status deal', 'Energy', 1000, 'ZAR', '2027-06-30'));
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000005"}', true);
select throws_ok(format($$select public.deal_approval_status(%L)$$, (select id from status_ids where name = 'deal')),
  'P0002', 'deal not found', 'a caller without deal.view cannot inspect approval status');
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000004"}', true);
select throws_ok(format($$select public.deal_approval_status(%L)$$, (select id from status_ids where name = 'deal')),
  'P0002', 'deal not found', 'another tenant cannot inspect approval status');
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000001"}', true);
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'canConfigure', 'true',
  'Owner can configure the approval policy');
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'canRequest', 'false',
  'status does not offer a request before the deal reaches IC review and policy exists');
select is(jsonb_typeof(public.deal_approval_status((select id from status_ids where name = 'deal'))->'configuredApprovals'), 'null',
  'unconfigured tenants do not receive an implicit quorum');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000001"}', true);
select public.configure_approval_policy('22222222-0000-4000-8000-00000000000a', 1);
reset role;
update public.deals set stage = 'ic_review', version = 2 where id = (select id from status_ids where name = 'deal');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000002"}', true);
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'canRequest', 'true',
  'eligible deal lead can request at IC review after quorum is configured');
insert into status_ids values ('request', public.request_approval((select id from status_ids where name = 'deal'), 2));
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'status', 'pending',
  'status reports the open request');
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'canRequest', 'false',
  'a second request is hidden while the current request remains pending');
select set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000003"}', true);
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'canDecide', 'true',
  'snapshotted IC approver sees an actionable decision');
select is(public.deal_approval_status((select id from status_ids where name = 'deal'))->>'pendingCount', '1',
  'status reports the unresolved approver count');
reset role;
select * from finish();
rollback;
