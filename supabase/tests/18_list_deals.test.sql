-- Feature 03: deal list RPC enforces permission, tenant scope and bounded query inputs.
begin;
select plan(11);
select has_function('public', 'list_deals', array['uuid', 'text', 'text', 'integer', 'integer'],
  'deal list RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.list_deals(uuid,text,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_deals(uuid,text,text,integer,integer)', 'EXECUTE'),
  'only authenticated users can call the deal list RPC'
);
insert into auth.users (id, instance_id, aud, role, email) values
  ('12121212-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deallist1@example.test'),
  ('12121212-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'deallist2@example.test');
insert into public.tenants (id, name) values
  ('13131313-0000-4000-8000-00000000000a', 'Deal list A'),
  ('13131313-0000-4000-8000-00000000000b', 'Deal list B');
select app.seed_system_roles(id) from public.tenants where id in (
  '13131313-0000-4000-8000-00000000000a', '13131313-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('13131313-0000-4000-8000-00000000000a', '12121212-0000-4000-8000-000000000001'),
  ('13131313-0000-4000-8000-00000000000b', '12121212-0000-4000-8000-000000000002');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id
where r.key = 'deal_lead' and m.tenant_id in ('13131313-0000-4000-8000-00000000000a', '13131313-0000-4000-8000-00000000000b');
create temporary table deal_list_ids (full_id uuid, bare_id uuid);
grant all on deal_list_ids to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"12121212-0000-4000-8000-000000000001"}', true);
insert into deal_list_ids values (
  public.create_deal('13131313-0000-4000-8000-00000000000a', 'Northstar Systems', 'Technology', 123456789012345, 'ZAR', '2027-03-31'),
  public.create_deal('13131313-0000-4000-8000-00000000000a', 'Other prospect')
);
select is(public.list_deals('13131313-0000-4000-8000-00000000000a', null, null, 25, 0) ->> 'total',
  '2', 'the list includes all unarchived tenant deals');
select is(public.list_deals('13131313-0000-4000-8000-00000000000a', null, 'northstar', 25, 0)
  #>> '{items,0,amount}', '123456789012345', 'money is encoded as an exact integer string and search is case-insensitive');
select is(public.list_deals('13131313-0000-4000-8000-00000000000a', 'screening', null, 25, 0) ->> 'total',
  '0', 'stage filtering is applied in the database');
select throws_ok($$select public.list_deals('13131313-0000-4000-8000-00000000000a', 'bogus', null, 25, 0)$$,
  '22023', null, 'unknown stages are rejected');
select throws_ok($$select public.list_deals('13131313-0000-4000-8000-00000000000a', null, null, 101, 0)$$,
  '22023', null, 'pagination is bounded');
select throws_ok($$select public.list_deals('13131313-0000-4000-8000-00000000000a', null, null, null, 0)$$,
  '22023', null, 'a null limit cannot disable pagination bounds');
select throws_ok($$select public.list_deals('13131313-0000-4000-8000-00000000000a', null, null, 25, null)$$,
  '22023', null, 'a null offset is rejected');
select set_config('request.jwt.claims', '{"sub":"12121212-0000-4000-8000-000000000002"}', true);
select throws_ok($$select public.list_deals('13131313-0000-4000-8000-00000000000a', null, null, 25, 0)$$,
  '42501', 'permission denied', 'a different tenant cannot list these deals');
reset role;
set local role anon;
select throws_ok($$select public.list_deals('13131313-0000-4000-8000-00000000000a', null, null, 25, 0)$$,
  '42501', null, 'anon cannot call the deal list RPC');
reset role;
select * from finish();
rollback;
