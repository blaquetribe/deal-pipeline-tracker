-- Feature 01, slice 2: permission catalogue, per-tenant roles, has_permission, static separation of
-- duties, immutable system roles, and default-deny reads and writes. Written before the migration.
begin;
select plan(35);

-- Structure -----------------------------------------------------------------------------------------
select has_table('public', 'permissions', 'permissions catalogue exists');
select has_table('public', 'permission_conflicts', 'conflicting permission pairs are data');
select has_table('public', 'roles', 'roles exists');
select has_table('public', 'role_permissions', 'role_permissions exists');
select has_table('public', 'membership_roles', 'membership_roles exists');
select is(
  (select count(*) from pg_class
    where oid = any (array[to_regclass('public.permissions'), to_regclass('public.permission_conflicts'),
                           to_regclass('public.roles'), to_regclass('public.role_permissions'),
                           to_regclass('public.membership_roles')])
      and relrowsecurity and relforcerowsecurity),
  5::bigint, 'RLS is enabled AND forced on every RBAC table'
);
select is(
  (select count(*) from unnest(array['permissions', 'permission_conflicts', 'roles', 'role_permissions', 'membership_roles']) as t(name)
    where has_table_privilege('authenticated', to_regclass('public.' || t.name), 'INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'authenticated has no direct write privilege on any RBAC table'
);
select is(
  (select count(*) from unnest(array['permissions', 'permission_conflicts', 'roles', 'role_permissions', 'membership_roles']) as t(name)
    where has_table_privilege('anon', to_regclass('public.' || t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'anon has no privilege at all on the RBAC tables'
);

-- Fixtures: two tenants with their system roles, and one user per situation -----------------------------
insert into auth.users (id, instance_id, aud, role, email)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@example.test'
from generate_series(1, 7) as n;
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Tenant B');
select app.seed_system_roles(id) from public.tenants;

-- u1 owner, u2 deal lead, u3 IC member, u4 observer, u5 member with no role, u6 deactivated lead (all A); u7 lead of B
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000003'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000004'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000005'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000006'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000007');
update public.memberships set deactivated_at = now() where user_id = 'aaaaaaaa-0000-4000-8000-000000000006';
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'deal_lead'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'ic_member'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'observer_compliance'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'deal_lead'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'deal_lead')
) as v(user_id, role_key)
join public.memberships m on m.user_id = v.user_id
join public.roles r on r.tenant_id = m.tenant_id and r.key = v.role_key;
insert into public.deals (id, tenant_id, name) values
  ('cccccccc-0000-4000-8000-0000000000da', 'bbbbbbbb-0000-4000-8000-00000000000a', 'Deal A'),
  ('cccccccc-0000-4000-8000-0000000000db', 'bbbbbbbb-0000-4000-8000-00000000000b', 'Deal B');

-- Catalogue and seeded roles --------------------------------------------------------------------------------
select is((select count(*) from public.roles where tenant_id = 'bbbbbbbb-0000-4000-8000-00000000000a' and is_system), 6::bigint,
  'each tenant gets the six system roles');
select is(
  (select count(*) from public.roles r where r.is_system
    and app.perm_set_conflicts(array(select rp.permission from public.role_permissions rp where rp.role_id = r.id))),
  0::bigint, 'no system role contains a conflicting permission pair'
);
select ok(exists (select 1 from public.permissions where key = 'deal.note')
      and exists (select 1 from public.permissions where key = 'approval.decide'), 'the catalogue holds the permissions the code relies on');

-- has_permission: default deny, tenant bound, membership bound ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select ok(app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'deal.note'), 'a deal lead may post notes in their tenant');
select ok(not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000b', 'deal.note'), 'and has no permission in another tenant');
select ok(not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'no.such.permission'), 'an unknown permission is denied');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
select ok(app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'deal.view')
      and not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'deal.note'), 'an observer can view but not post');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000005"}', true);
select ok(not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'deal.view'), 'a member with no role has no permission');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000006"}', true);
select ok(not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'deal.note'), 'a deactivated member has no permission');
select set_config('request.jwt.claims', '{}', true);
select ok(not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'deal.view'), 'with no user at all, everything is denied');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select ok(not app.has_permission('bbbbbbbb-0000-4000-8000-00000000000a', 'approval.decide'), 'the owner administers people and cannot decide approvals');

-- Reads are default deny: the permission, not mere membership, opens the data ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000005"}', true);
select is((select count(*) from public.deals), 0::bigint, 'a member with no role sees no deals');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
select is((select count(*) from public.deals), 1::bigint, 'an observer sees the deals of their tenant only');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select is((select count(*) from public.roles), 6::bigint, 'a member sees the roles of their own tenant only');
select ok((select count(*) from public.permissions) > 0, 'the catalogue is readable by any signed-in user');

-- post_event now needs the permission --------------------------------------------------------------------------------------
select ok((select public.post_event('cccccccc-0000-4000-8000-0000000000da', 'note', 'hello')) is not null, 'a deal lead can post a note');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
select throws_ok($$select public.post_event('cccccccc-0000-4000-8000-0000000000da', 'note', 'x')$$, '42501', 'permission denied',
  'an observer cannot post a note');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000005"}', true);
select throws_ok($$select public.post_event('cccccccc-0000-4000-8000-0000000000da', 'note', 'x')$$, '42501', 'permission denied',
  'a member with no role cannot post a note');
reset role;

-- Function exposure ----------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'app.has_permission(uuid,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'app.has_permission(uuid,text)', 'EXECUTE'),
  'has_permission is executable by authenticated and not by anon');
select ok(not has_function_privilege('authenticated', 'app.seed_system_roles(uuid)', 'EXECUTE'),
  'seeding system roles is not callable by users');

-- Static separation of duties ---------------------------------------------------------------------------------------------------
insert into public.roles (id, tenant_id, key, name) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000000a', 'custom_x', 'Custom X');
insert into public.role_permissions (tenant_id, role_id, permission) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001', 'deal.request_approval');
select throws_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-000000000001', 'approval.decide')$$,
  '23514', 'separation of duties conflict', 'a role cannot combine requesting and deciding approvals');
select throws_ok(
  $$insert into public.membership_roles (tenant_id, membership_id, role_id)
    select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = 'ic_member'
    where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', 'separation of duties conflict', 'the union of a user''s roles cannot conflict (owner plus IC member)');
select throws_ok(
  $$insert into public.membership_roles (tenant_id, membership_id, role_id)
    select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = 'ic_member'
    where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000002'$$,
  '23514', 'separation of duties conflict', 'nor can a deal lead also be an IC member');

-- System roles are immutable --------------------------------------------------------------------------------------------------------
select throws_ok($$update public.roles set name = 'x' where is_system$$, 'P0001', 'system roles are immutable', 'a system role cannot be renamed');
select throws_ok($$delete from public.roles where is_system$$, 'P0001', 'system roles are immutable', 'a system role cannot be deleted');
select throws_ok(
  $$insert into public.role_permissions (tenant_id, role_id, permission) select tenant_id, id, 'deal.create' from public.roles where key = 'observer_compliance' limit 1$$,
  'P0001', 'system roles are immutable', 'a system role cannot gain a permission');
select throws_ok($$delete from public.role_permissions rp using public.roles r where r.id = rp.role_id and r.is_system$$,
  'P0001', 'system roles are immutable', 'a system role cannot lose a permission');

select * from finish();
rollback;
