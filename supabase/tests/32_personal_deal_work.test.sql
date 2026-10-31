begin;
select plan(11);
select has_function('public', 'list_my_deal_work', array['uuid', 'integer', 'integer'],
  'personal work RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.list_my_deal_work(uuid,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_my_deal_work(uuid,integer,integer)', 'EXECUTE'),
  'only authenticated users can call the personal work RPC'
);
insert into auth.users (id, instance_id, aud, role, email) values
  ('32323232-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mywork1@example.test'),
  ('32323232-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mywork2@example.test');
insert into public.tenants (id, name) values
  ('33333333-0000-4000-8000-00000000000a', 'Personal work A'),
  ('33333333-0000-4000-8000-00000000000b', 'Personal work B');
select app.seed_system_roles(id) from public.tenants where id in (
  '33333333-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('33333333-0000-4000-8000-00000000000a', '32323232-0000-4000-8000-000000000001'),
  ('33333333-0000-4000-8000-00000000000b', '32323232-0000-4000-8000-000000000002');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id
where r.key = 'deal_lead' and m.tenant_id in ('33333333-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-00000000000b');
create temporary table my_work_ids (assigned_deal uuid, other_deal uuid, passed_deal uuid);
grant all on my_work_ids to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32323232-0000-4000-8000-000000000001"}', true);
insert into my_work_ids values (
  public.create_deal('33333333-0000-4000-8000-00000000000a', 'My assigned deal', 'Energy', 500000, 'ZAR', '2027-02-28'),
  public.create_deal('33333333-0000-4000-8000-00000000000a', 'Not my assignment'),
  public.create_deal('33333333-0000-4000-8000-00000000000a', 'Passed deal')
);
select public.set_deal_assignees(assigned_deal, 1,
  '[{"user_id":"32323232-0000-4000-8000-000000000001","role":"lead"}]'::jsonb)
from my_work_ids;
select public.set_deal_assignees(passed_deal, 1,
  '[{"user_id":"32323232-0000-4000-8000-000000000001","role":"member"}]'::jsonb)
from my_work_ids;
select public.move_stage(passed_deal, 'passed', 2, 'Not a fit') from my_work_ids;
select is(public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, 0) ->> 'total',
  '2', 'only deals assigned to the current user are included');
select is(public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, 0) ->> 'activeCount',
  '1', 'active assignment count excludes terminal outcomes');
select is(public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, 0)
  #>> '{items,0,assignment_role}', 'lead', 'the caller’s assignment role is included');
select is(public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, 0)
  #>> '{items,0,amount}', '500000', 'money remains an exact integer string');
select throws_ok($$select public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 101, 0)$$,
  '22023', null, 'pagination is bounded');
select throws_ok($$select public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', null, 0)$$,
  '22023', null, 'null limit is rejected');
select throws_ok($$select public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, null)$$,
  '22023', null, 'null offset is rejected');
select set_config('request.jwt.claims', '{"sub":"32323232-0000-4000-8000-000000000002"}', true);
select throws_ok($$select public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, 0)$$,
  '42501', 'permission denied', 'another tenant cannot read personal work from this tenant');
reset role;
set local role anon;
select throws_ok($$select public.list_my_deal_work('33333333-0000-4000-8000-00000000000a', 25, 0)$$,
  '42501', null, 'anon cannot call the personal work RPC');
reset role;
select * from finish();
rollback;
