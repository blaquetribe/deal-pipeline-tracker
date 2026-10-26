-- Feature 01, slice 3: create_deal and move_stage. The stage machine, the required fields per stage,
-- optimistic concurrency and permissions are enforced in the database. Written before the migration.
begin;
select plan(33);

-- Structure -------------------------------------------------------------------------------------------
select has_table('public', 'stage_transitions', 'allowed transitions are data');
select has_table('public', 'stage_requirements', 'required fields per stage are data');
select is(
  (select count(*) from pg_class
    where oid = any (array[to_regclass('public.stage_transitions'), to_regclass('public.stage_requirements')])
      and relrowsecurity and relforcerowsecurity),
  2::bigint, 'RLS is enabled AND forced on both'
);
select is(
  (select count(*) from unnest(array['stage_transitions', 'stage_requirements']) as t(name)
    where has_table_privilege('authenticated', to_regclass('public.' || t.name), 'INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('anon', to_regclass('public.' || t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'no direct write for authenticated, no access for anon'
);
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'deals'
      and column_name in ('sector', 'amount', 'currency', 'expected_close_date', 'expected_close_time')),
  5::bigint, 'deals carry sector, amount, currency, expected close date and optional time'
);
select col_type_is('public', 'deals', 'amount', 'bigint', 'money is bigint minor units, never a float');
select ok(
  not exists (
    select 1 from public.stage_requirements r
    where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = 'deals' and c.column_name = r.field)
  ), 'every required field is a real column of deals'
);

-- Fixtures ----------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || n || '@example.test'
from generate_series(1, 4) as n;
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Tenant B');
select app.seed_system_roles(id) from public.tenants;
-- u1 deal lead (A), u2 observer (A), u3 IC member (A), u4 deal lead (B)
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000003'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000004');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'deal_lead'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'observer_compliance'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'ic_member'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'deal_lead')
) as v(user_id, role_key)
join public.memberships m on m.user_id = v.user_id
join public.roles r on r.tenant_id = m.tenant_id and r.key = v.role_key;

create temp table ids (k text primary key, id uuid);
grant all on ids to public;

-- create_deal -------------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
insert into ids select 'full', public.create_deal(
  p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Full', p_sector => 'Technology',
  p_amount => 250000000, p_expected_close => '2027-03-31');
insert into ids select 'bare', public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Bare');
insert into ids select 'pass', public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Pass me');
insert into ids select 'ic', public.create_deal(
  p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'At IC', p_sector => 'Energy',
  p_amount => 1, p_expected_close => '2027-01-01');
insert into ids select 'arch', public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Archived');

select is((select stage || ' v' || version || ' ' || currency from public.deals where id = (select id from ids where k = 'full')),
  'sourcing v1 ZAR', 'a new deal starts at sourcing, version 1, default currency ZAR');
select is((select tenant_id from public.deals where id = (select id from ids where k = 'full')),
  'bbbbbbbb-0000-4000-8000-00000000000a'::uuid, 'and belongs to the tenant it was created in');
select is((select count(*) from public.deal_events
            where deal_id = (select id from ids where k = 'full') and kind = 'field_change' and body = 'Deal created'),
  1::bigint, 'creation is recorded in the ledger');

select throws_ok($$select public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000b', p_name => 'Cross tenant')$$,
  '42501', 'permission denied', 'a lead of tenant A cannot create a deal in tenant B');
select throws_ok($$select public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'x', p_currency => 'zar')$$,
  '23514', null, 'a currency must be an upper-case ISO code');
select throws_ok($$select public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'x', p_amount => -1)$$,
  '23514', null, 'an amount cannot be negative');
select throws_ok($$update public.deals set stage = 'closed'$$, '42501', null, 'stage cannot be written directly');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select throws_ok($$select public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'x')$$,
  '42501', 'permission denied', 'an observer cannot create a deal');
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'x')$$,
  '42501', 'permission denied', 'with no signed-in user nothing can be created');
reset role;

-- Function exposure -----------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.move_stage(uuid,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.move_stage(uuid,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_deal(uuid,text,text,bigint,text,date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_deal(uuid,text,text,bigint,text,date)', 'EXECUTE'),
  'create_deal and move_stage are for authenticated only'
);

-- Fixture states that need a superuser: a deal at IC review and an archived deal.
update public.deals set stage = 'ic_review' where id = (select id from ids where k = 'ic');
update public.deals set archived_at = now() where id = (select id from ids where k = 'arch');

-- move_stage ---------------------------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);

select is(public.move_stage((select id from ids where k = 'full'), 'screening', 1), 2,
  'a legal move with its required fields returns the new version');
select is((select stage from public.deals where id = (select id from ids where k = 'full')), 'screening', 'and the stage changed');
select is((select body from public.deal_events where deal_id = (select id from ids where k = 'full') and kind = 'stage_change'),
  'sourcing -> screening', 'the move is recorded in the ledger');
select throws_ok(format($$select public.move_stage(%L, 'due_diligence', 1)$$, (select id from ids where k = 'full')),
  'DP409', 'stale version', 'a stale version is refused (409)');
select is(public.move_stage((select id from ids where k = 'full'), 'due_diligence', 2), 3, 'a fresh version succeeds');

select throws_ok(format($$select public.move_stage(%L, 'screening', 1)$$, (select id from ids where k = 'bare')),
  'DP422', 'missing required fields: amount, sector', 'a deal cannot enter a stage without its fields');
select throws_ok(format($$select public.move_stage(%L, 'due_diligence', 1)$$, (select id from ids where k = 'bare')),
  'DP422', 'transition not allowed', 'stages cannot be skipped');
select throws_ok(format($$select public.move_stage(%L, 'bogus', 1)$$, (select id from ids where k = 'bare')),
  'DP422', 'transition not allowed', 'an unknown stage is refused');
select throws_ok(format($$select public.move_stage(%L, 'signed', 1)$$, (select id from ids where k = 'ic')),
  'DP422', 'transition not allowed', 'signing is not a plain move: it needs the approval decision (feature 04)');

select is(public.move_stage((select id from ids where k = 'pass'), 'passed', 1, 'Valuation too high'), 2, 'a deal can be passed from sourcing');
select throws_ok(format($$select public.move_stage(%L, 'screening', 2)$$, (select id from ids where k = 'pass')),
  'DP422', 'transition not allowed', 'passed is terminal');
select throws_ok(format($$select public.move_stage(%L, 'screening', 1)$$, (select id from ids where k = 'arch')),
  '55000', 'deal is archived', 'an archived deal cannot move');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select throws_ok(format($$select public.move_stage(%L, 'screening', 1)$$, (select id from ids where k = 'bare')),
  '42501', 'permission denied', 'an observer cannot move a deal');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select throws_ok(format($$select public.move_stage(%L, 'screening', 1)$$, (select id from ids where k = 'bare')),
  '42501', 'permission denied', 'an IC member cannot move a deal either');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
select throws_ok(format($$select public.move_stage(%L, 'screening', 1)$$, (select id from ids where k = 'full')),
  'P0002', 'deal not found', 'a user of another tenant cannot tell the deal exists');
select set_config('request.jwt.claims', '{}', true);
select throws_ok(format($$select public.move_stage(%L, 'screening', 1)$$, (select id from ids where k = 'full')),
  'P0002', 'deal not found', 'with no signed-in user the deal does not exist either');
reset role;

select * from finish();
rollback;
