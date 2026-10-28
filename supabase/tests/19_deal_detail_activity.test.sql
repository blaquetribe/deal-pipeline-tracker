-- Feature 03: a deal viewer can read authorized detail and a paged, integrity-checked ledger.
begin;
select plan(21);

select has_function('public', 'deal_detail', array['uuid'], 'deal detail RPC exists');
select has_function('public', 'deal_activity', array['uuid', 'integer', 'bigint'], 'deal activity RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.deal_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.deal_detail(uuid)', 'EXECUTE'),
  'deal detail is executable by authenticated and not anon'
);
select ok(
  has_function_privilege('authenticated', 'public.deal_activity(uuid,integer,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.deal_activity(uuid,integer,bigint)', 'EXECUTE'),
  'deal activity is executable by authenticated and not anon'
);

insert into auth.users (id, instance_id, aud, role, email) values
  ('19191919-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-owner@example.test'),
  ('19191919-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-no-permission@example.test'),
  ('19191919-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-other-tenant@example.test');
insert into public.tenants (id, name) values
  ('19191919-0000-4000-8000-00000000000a', 'Detail tenant A'),
  ('19191919-0000-4000-8000-00000000000b', 'Detail tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  '19191919-0000-4000-8000-00000000000a', '19191919-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('19191919-0000-4000-8000-00000000000a', '19191919-0000-4000-8000-000000000001'),
  ('19191919-0000-4000-8000-00000000000a', '19191919-0000-4000-8000-000000000002'),
  ('19191919-0000-4000-8000-00000000000b', '19191919-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = 'owner'
where m.user_id in ('19191919-0000-4000-8000-000000000001', '19191919-0000-4000-8000-000000000003');
create temp table fixture_deal (id uuid primary key);
grant all on fixture_deal to public;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"19191919-0000-4000-8000-000000000001"}', true);
insert into fixture_deal values (public.create_deal(
  p_tenant => '19191919-0000-4000-8000-00000000000a', p_name => 'Activity target',
  p_sector => 'Energy', p_amount => 12345, p_expected_close => '2027-03-31'));
select public.post_event((select id from fixture_deal), 'note', 'A plain text note');

select is(public.deal_detail((select id from fixture_deal))->>'name', 'Activity target', 'detail returns the deal name');
select is(public.deal_detail((select id from fixture_deal))->>'amount', '12345', 'detail encodes bigint money as exact text');
select is(public.deal_detail((select id from fixture_deal))->>'expected_close_date', '2027-03-31', 'detail returns calendar dates without timezone conversion');
select is((public.deal_activity((select id from fixture_deal), 1, null)->'events'->0->>'kind'), 'note', 'activity is ordered newest first');
select is((public.deal_activity((select id from fixture_deal), 1, null)->'events'->0->>'body'), 'A plain text note', 'note text is returned as plain content');
select ok((public.deal_activity((select id from fixture_deal), 1, null)->>'hasMore')::boolean, 'activity pagination reports older events');
select ok((public.deal_activity((select id from fixture_deal), 1, null)->>'integrityOk')::boolean, 'activity includes a valid ledger integrity cue');
select is((public.deal_activity((select id from fixture_deal), 1, null)->'events'->0->>'actor_id'), '19191919-0000-4000-8000-000000000001', 'activity attribution comes from the authenticated user');
select is((public.deal_activity((select id from fixture_deal), 1,
  ((public.deal_activity((select id from fixture_deal), 1, null)->'events'->0->>'seq')::bigint))->'events'->0->>'kind'),
  'field_change', 'activity cursor returns the earlier event');
select throws_ok(format($$select public.deal_activity(%L, null, null)$$, (select id from fixture_deal)),
  '22023', 'invalid activity limit', 'a null page size is rejected');
select throws_ok(format($$select public.deal_activity(%L, 101, null)$$, (select id from fixture_deal)),
  '22023', 'invalid activity limit', 'activity page size is bounded');
select throws_ok(format($$select public.deal_activity(%L, 10, 0)$$, (select id from fixture_deal)),
  '22023', 'invalid activity cursor', 'an invalid activity cursor is rejected');

select set_config('request.jwt.claims', '{"sub":"19191919-0000-4000-8000-000000000002"}', true);
select throws_ok(format($$select public.deal_detail(%L)$$, (select id from fixture_deal)),
  'P0002', 'deal not found', 'RLS hides details from a tenant member without deal.view');
select throws_ok(format($$select public.deal_activity(%L, 10, null)$$, (select id from fixture_deal)),
  'P0002', 'deal not found', 'RLS hides activity from a tenant member without deal.view');

select set_config('request.jwt.claims', '{"sub":"19191919-0000-4000-8000-000000000003"}', true);
select throws_ok(format($$select public.deal_detail(%L)$$, (select id from fixture_deal)),
  'P0002', 'deal not found', 'another tenant cannot tell the deal exists');
select throws_ok(format($$select public.deal_activity(%L, 10, null)$$, (select id from fixture_deal)),
  'P0002', 'deal not found', 'another tenant cannot read its activity');
reset role;
set local role anon;
select throws_ok(format($$select public.deal_detail(%L)$$, (select id from fixture_deal)),
  '42501', null, 'anonymous users cannot call deal detail');
reset role;

select * from finish();
rollback;
