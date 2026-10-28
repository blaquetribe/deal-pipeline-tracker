-- Feature 03: assignment reads execute as the authenticated caller and honor deal.view RLS.
begin;
select plan(5);
select has_function('public', 'deal_assignees_for_deal', array['uuid'],
  'assignment list RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.deal_assignees_for_deal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.deal_assignees_for_deal(uuid)', 'EXECUTE'),
  'only authenticated users can call the assignment list RPC'
);

insert into auth.users (id, instance_id, aud, role, email) values
  ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'list1@example.test'),
  ('eeeeeeee-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'list2@example.test'),
  ('eeeeeeee-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'list3@example.test');
insert into public.tenants (id, name) values
  ('ffffffff-0000-4000-8000-00000000000a', 'List tenant A'),
  ('ffffffff-0000-4000-8000-00000000000b', 'List tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  'ffffffff-0000-4000-8000-00000000000a', 'ffffffff-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('ffffffff-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001'),
  ('ffffffff-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000002'),
  ('ffffffff-0000-4000-8000-00000000000b', 'eeeeeeee-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m
join public.roles r on r.tenant_id = m.tenant_id
where (m.user_id = 'eeeeeeee-0000-4000-8000-000000000001' and r.key = 'deal_lead')
   or (m.user_id = 'eeeeeeee-0000-4000-8000-000000000002' and r.key = 'observer_compliance')
   or (m.user_id = 'eeeeeeee-0000-4000-8000-000000000003' and r.key = 'deal_lead');
create temporary table list_assignee_ids (deal_id uuid primary key);
grant all on list_assignee_ids to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}', true);
insert into list_assignee_ids values (public.create_deal('ffffffff-0000-4000-8000-00000000000a', 'List deal'));
select public.set_deal_assignees((select deal_id from list_assignee_ids), 1,
  '[{"user_id":"eeeeeeee-0000-4000-8000-000000000001","role":"owner"}]'::jsonb);
select is((select count(*) from public.deal_assignees_for_deal((select deal_id from list_assignee_ids))),
  1::bigint, 'a deal viewer can list assignments for a visible deal');
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-000000000003"}', true);
select is((select count(*) from public.deal_assignees_for_deal((select deal_id from list_assignee_ids))),
  0::bigint, 'a different tenant cannot list assignments');
reset role;
set local role anon;
select throws_ok(format($$select * from public.deal_assignees_for_deal(%L)$$,
  (select deal_id from list_assignee_ids)), '42501', null, 'anon cannot call the assignment list RPC');
reset role;
select * from finish();
rollback;
