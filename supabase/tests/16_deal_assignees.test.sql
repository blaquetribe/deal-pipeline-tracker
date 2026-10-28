-- Feature 03, slice 1: deal responsibility is tenant-bound, auditable, and does not grant access.
begin;
select plan(20);

select has_table('public', 'deal_assignees', 'deal assignments have their own relation');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.deal_assignees'::regclass),
  'RLS is enabled and forced');
select ok((select attnotnull from pg_attribute where attrelid = 'public.deal_assignees'::regclass and attname = 'tenant_id'),
  'every assignment has a tenant');
select ok(exists (
  select 1 from pg_constraint c
  where c.conrelid = 'public.deal_assignees'::regclass and c.contype = 'p'
    and c.conkey = array[
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'tenant_id'),
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'deal_id'),
      (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'user_id')
    ]::smallint[]
), 'a user has one assignment per deal');
select ok(
  has_table_privilege('authenticated', 'public.deal_assignees', 'SELECT')
  and not has_table_privilege('authenticated', 'public.deal_assignees', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('anon', 'public.deal_assignees', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'authenticated users read by RLS; writes go through the function; anon has no access'
);
select ok(
  has_function_privilege('authenticated', 'public.set_deal_assignees(uuid,integer,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_deal_assignees(uuid,integer,jsonb)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
    where p.oid = 'public.set_deal_assignees(uuid,integer,jsonb)'::regprocedure
      and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  ),
  'only authenticated callers can change assignments'
);

insert into auth.users (id, instance_id, aud, role, email)
select ('cccccccc-0000-4000-8000-00000000000' || n)::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assign' || n || '@example.test'
from generate_series(1, 4) as n;
insert into public.tenants (id, name) values
  ('dddddddd-0000-4000-8000-00000000000a', 'Assignee Tenant A'),
  ('dddddddd-0000-4000-8000-00000000000b', 'Assignee Tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  'dddddddd-0000-4000-8000-00000000000a', 'dddddddd-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('dddddddd-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-000000000001'),
  ('dddddddd-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-000000000002'),
  ('dddddddd-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-000000000004'),
  ('dddddddd-0000-4000-8000-00000000000b', 'cccccccc-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m
join public.roles r on r.tenant_id = m.tenant_id
where (m.user_id = 'cccccccc-0000-4000-8000-000000000001' and r.key = 'deal_lead')
   or (m.user_id = 'cccccccc-0000-4000-8000-000000000002' and r.key = 'observer_compliance')
   or (m.user_id = 'cccccccc-0000-4000-8000-000000000004' and r.key = 'deal_member')
   or (m.user_id = 'cccccccc-0000-4000-8000-000000000003' and r.key = 'deal_lead');

create temporary table assignment_ids (deal_id uuid primary key);
grant all on assignment_ids to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000001"}', true);
insert into assignment_ids values (public.create_deal(
  'dddddddd-0000-4000-8000-00000000000a', 'Assignment test deal'));

select is(public.set_deal_assignees((select deal_id from assignment_ids), 1,
  '[{"user_id":"cccccccc-0000-4000-8000-000000000001","role":"owner"},{"user_id":"cccccccc-0000-4000-8000-000000000004","role":"member"}]'::jsonb),
  2, 'an editor can replace assignments and gets the new deal version');
select is((select string_agg(a.role || ':' || a.user_id::text, ',' order by a.role)
  from public.deal_assignees a where a.deal_id = (select deal_id from assignment_ids)),
  'member:cccccccc-0000-4000-8000-000000000004,owner:cccccccc-0000-4000-8000-000000000001',
  'owner and member are stored for the same tenant deal');
select is((select count(*) from public.deal_events e where e.deal_id = (select deal_id from assignment_ids)
  and e.kind = 'field_change' and e.body like 'Assignees updated:%'), 1::bigint,
  'the assignment change is recorded in the immutable deal ledger');
select throws_ok(format($$select public.set_deal_assignees(%L, 1, '[]'::jsonb)$$,
  (select deal_id from assignment_ids)), 'DP409', 'stale version', 'stale assignment writes are rejected');
select throws_ok(format($$select public.set_deal_assignees(%L, null, '[]'::jsonb)$$,
  (select deal_id from assignment_ids)), '22023', 'invalid version', 'a null version cannot bypass optimistic concurrency');
select throws_ok(format($$select public.set_deal_assignees(%L, 2,
  '[{"user_id":"cccccccc-0000-4000-8000-000000000003","role":"lead"}]'::jsonb)$$,
  (select deal_id from assignment_ids)), 'P0002', 'assignee is not an active tenant member',
  'a member of another tenant cannot be assigned');
select throws_ok(format($$select public.set_deal_assignees(%L, 2,
  '[{"user_id":"cccccccc-0000-4000-8000-000000000004","role":"bogus"}]'::jsonb)$$,
  (select deal_id from assignment_ids)), '22023', null, 'unknown roles are refused');
select throws_ok(format($$select public.set_deal_assignees(%L, 2,
  '[{"user_id":"cccccccc-0000-4000-8000-000000000004","role":"owner"},{"user_id":"cccccccc-0000-4000-8000-000000000001","role":"owner"}]'::jsonb)$$,
  (select deal_id from assignment_ids)), '23505', null, 'a deal can have only one owner assignee');
select throws_ok(format($$select public.set_deal_assignees(%L, 2,
  '[{"user_id":"cccccccc-0000-4000-8000-000000000004","role":"member","tenant_id":"dddddddd-0000-4000-8000-00000000000b"}]'::jsonb)$$,
  (select deal_id from assignment_ids)), '22023', 'unsupported assignment field',
  'client-supplied tenant fields are rejected');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000002"}', true);
select throws_ok(format($$select public.set_deal_assignees(%L, 2, '[]'::jsonb)$$,
  (select deal_id from assignment_ids)), '42501', 'permission denied',
  'a viewer without deal.edit cannot change assignments');
select is((select count(*) from public.deal_assignees where deal_id = (select deal_id from assignment_ids)),
  2::bigint, 'a deal viewer sees assignments but cannot mutate them');
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003"}', true);
select is((select count(*) from public.deal_assignees where deal_id = (select deal_id from assignment_ids)),
  0::bigint, 'another tenant cannot see the deal assignments');
select throws_ok(format($$select public.set_deal_assignees(%L, 2, '[]'::jsonb)$$,
  (select deal_id from assignment_ids)), 'P0002', 'deal not found',
  'another tenant cannot tell that the deal exists');
select set_config('request.jwt.claims', '{}', true);
select throws_ok(format($$select public.set_deal_assignees(%L, 2, '[]'::jsonb)$$,
  (select deal_id from assignment_ids)), 'P0002', 'deal not found',
  'signed-out callers cannot change assignments');
reset role;

select * from finish();
rollback;
