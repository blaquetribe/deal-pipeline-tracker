-- Feature 01, slice 1: tenant isolation, forced RLS and write privileges on the core tables.
-- Written before the migration (tests first): every assertion fails until the schema exists.
begin;
select plan(21);

-- Structure -----------------------------------------------------------------------------------
select has_table('public', 'tenants', 'tenants exists');
select has_table('public', 'memberships', 'memberships exists');
select has_table('public', 'deals', 'deals exists');
select has_table('public', 'deal_events', 'deal_events (the ledger) exists');

select is(
  (select count(*) from pg_class
    where oid = any (array[to_regclass('public.tenants'), to_regclass('public.memberships'),
                           to_regclass('public.deals'), to_regclass('public.deal_events')])
      and relrowsecurity and relforcerowsecurity),
  4::bigint,
  'RLS is enabled AND forced on every core table'
);
select is(
  (select count(*) from pg_attribute
    where attname = 'tenant_id' and attnotnull and not attisdropped
      and attrelid = any (array[to_regclass('public.memberships'), to_regclass('public.deals'),
                                to_regclass('public.deal_events')])),
  3::bigint,
  'tenant_id is NOT NULL on memberships, deals and deal_events'
);
select is(
  (select count(*) from unnest(array['tenants', 'memberships', 'deals', 'deal_events']) as t(name)
    where has_table_privilege('authenticated', to_regclass('public.' || t.name), 'INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint,
  'authenticated has no direct write privilege on any core table (writes go through functions)'
);
select is(
  (select count(*) from unnest(array['tenants', 'memberships', 'deals', 'deal_events']) as t(name)
    where has_table_privilege('anon', to_regclass('public.' || t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint,
  'anon has no privilege at all on the core tables'
);
select is(
  (select count(*) from unnest(array['tenants', 'memberships', 'deals', 'deal_events']) as t(name)
    where has_table_privilege('authenticated', to_regclass('public.' || t.name), 'SELECT')),
  4::bigint,
  'authenticated can read every core table, filtered by RLS'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0::bigint,
  'no function in public is executable by PUBLIC or anon'
);

-- Fixtures (as the superuser running the tests): two tenants, one deal and one note each ----------
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u3@example.test');
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Tenant B');
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000002');
-- Reading deals needs a permission, not just membership (slice 2): both users are observers.
select app.seed_system_roles(id) from public.tenants;
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m
join public.roles r on r.tenant_id = m.tenant_id and r.key = 'observer_compliance';
insert into public.deals (id, tenant_id, name) values
  ('cccccccc-0000-4000-8000-0000000000da', 'bbbbbbbb-0000-4000-8000-00000000000a', 'Deal A'),
  ('cccccccc-0000-4000-8000-0000000000db', 'bbbbbbbb-0000-4000-8000-00000000000b', 'Deal B');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.deal_events (tenant_id, deal_id, kind, body) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-0000000000da', 'note', 'note in A');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into public.deal_events (tenant_id, deal_id, kind, body) values
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'cccccccc-0000-4000-8000-0000000000db', 'note', 'note in B');

-- Cross-tenant reads, as user 1 (member of tenant A only) -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.deals), 1::bigint, 'user in A sees exactly one deal');
select is((select id from public.deals), 'cccccccc-0000-4000-8000-0000000000da'::uuid, 'and it is the deal of tenant A');
select is((select count(*) from public.tenants), 1::bigint, 'user in A sees only tenant A');
select is((select count(*) from public.memberships), 1::bigint, 'user in A sees only the memberships of tenant A');
select is((select count(*) from public.deal_events), 1::bigint, 'user in A sees only the ledger rows of tenant A');

select throws_ok($$insert into public.deals (tenant_id, name) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'x')$$, '42501', null, 'authenticated cannot INSERT into deals');
select throws_ok($$update public.deals set name = 'x'$$, '42501', null, 'authenticated cannot UPDATE deals');
select throws_ok($$delete from public.deals$$, '42501', null, 'authenticated cannot DELETE from deals');

-- The tenant comes from the membership row, never from anything the client can influence.
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated","tenant_id":"bbbbbbbb-0000-4000-8000-00000000000b","app_metadata":{"tenant_id":"bbbbbbbb-0000-4000-8000-00000000000b"}}', true);
select is(
  (select array_agg(distinct tenant_id) from public.deals),
  array['bbbbbbbb-0000-4000-8000-00000000000a']::uuid[],
  'a forged tenant_id claim does not widen what the user can read'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.deals), 0::bigint, 'a user with no membership sees no deals');

reset role;
select throws_ok(
  $$insert into public.deal_events (tenant_id, deal_id, kind, body) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-0000000000db', 'note', 'cross-tenant')$$,
  '23503', null, 'a ledger row cannot attach to a deal of another tenant (composite foreign key)'
);

select * from finish();
rollback;
