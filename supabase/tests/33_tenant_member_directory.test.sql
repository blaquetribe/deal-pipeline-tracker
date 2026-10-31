begin;
select plan(9);
select has_function('public', 'tenant_members', array['uuid'], 'tenant member directory RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.tenant_members(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.tenant_members(uuid)', 'EXECUTE'),
  'only authenticated callers can invoke the member directory RPC'
);
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('34343434-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@members-a.example.test', '{"full_name":"Owner A"}'),
  ('34343434-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@members-a.example.test', '{"full_name":"Member A"}'),
  ('34343434-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@members-b.example.test', '{"full_name":"Owner B"}');
insert into public.tenants (id, name) values
  ('35353535-0000-4000-8000-00000000000a', 'Members A'),
  ('35353535-0000-4000-8000-00000000000b', 'Members B');
select app.seed_system_roles(id) from public.tenants where id in (
  '35353535-0000-4000-8000-00000000000a', '35353535-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('35353535-0000-4000-8000-00000000000a', '34343434-0000-4000-8000-000000000001'),
  ('35353535-0000-4000-8000-00000000000a', '34343434-0000-4000-8000-000000000002'),
  ('35353535-0000-4000-8000-00000000000b', '34343434-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from public.memberships m join public.roles r on r.tenant_id = m.tenant_id
where (m.user_id = '34343434-0000-4000-8000-000000000001' and r.key = 'owner')
   or (m.user_id = '34343434-0000-4000-8000-000000000002' and r.key = 'deal_member')
   or (m.user_id = '34343434-0000-4000-8000-000000000003' and r.key = 'owner');
update public.memberships set deactivated_at = now()
where user_id = '34343434-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"34343434-0000-4000-8000-000000000001"}', true);
select is(public.tenant_members('35353535-0000-4000-8000-00000000000a') #>> '{members,0,email}',
  'owner@members-a.example.test', 'owner can view same-tenant member identity');
select is(public.tenant_members('35353535-0000-4000-8000-00000000000a') #>> '{members,1,fullName}',
  'Member A', 'member display name is returned from auth metadata');
select is(public.tenant_members('35353535-0000-4000-8000-00000000000a') #>> '{members,1,roles,0,key}',
  'deal_member', 'member roles are included for management');
select isnt(public.tenant_members('35353535-0000-4000-8000-00000000000a') #>> '{members,1,deactivatedAt}',
  null, 'deactivated memberships remain visible in the roster');
select is((public.tenant_members('35353535-0000-4000-8000-00000000000a') #> '{members}')::text like '%owner@members-b.example.test%',
  false, 'members from another tenant are never returned');
select set_config('request.jwt.claims', '{"sub":"34343434-0000-4000-8000-000000000003"}', true);
select throws_ok($$select public.tenant_members('35353535-0000-4000-8000-00000000000a')$$,
  '42501', 'permission denied', 'cross-tenant manager cannot read the member roster');
reset role;
set local role anon;
select throws_ok($$select public.tenant_members('35353535-0000-4000-8000-00000000000a')$$,
  '42501', null, 'anonymous caller cannot invoke the member directory RPC');
reset role;
select * from finish();
rollback;
