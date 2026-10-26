-- Feature 01, slice 4: update_deal. Field edits are permissioned, versioned, validated against an
-- allow-list, cannot strip a field the current stage requires, and are recorded in the ledger.
begin;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@example.test', now()
from generate_series(1, 3) as n;
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Tenant B');
select app.seed_system_roles(id) from public.tenants;
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'deal_lead'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'observer_compliance'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'deal_lead')
) as v(user_id, role_key)
join public.memberships m on m.user_id = v.user_id
join public.roles r on r.tenant_id = m.tenant_id and r.key = v.role_key;

create temp table ids (k text primary key, id uuid);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
insert into ids select 'd', public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Target', p_sector => 'Energy', p_amount => 100);
insert into ids select 'scr', public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Screening', p_sector => 'Energy', p_amount => 100);
select public.move_stage((select id from ids where k = 'scr'), 'screening', 1);
insert into ids select 'arch', public.create_deal(p_tenant => 'bbbbbbbb-0000-4000-8000-00000000000a', p_name => 'Archived');
update public.deals set archived_at = now() where id = (select id from ids where k = 'arch');

select is(public.update_deal((select id from ids where k = 'd'), 1, '{"sector":"Mining","amount":"1500000","name":"Target II"}'), 2,
  'a lead can edit fields and gets the new version');
select is((select sector || '/' || amount || '/' || name from public.deals where id = (select id from ids where k = 'd')),
  'Mining/1500000/Target II', 'the fields changed, and the amount arrived as a string of minor units');
select is((select count(*) from public.deal_events where deal_id = (select id from ids where k = 'd') and kind = 'field_change' and body like 'Updated:%sector%'),
  1::bigint, 'the change is recorded in the ledger');
select is(public.update_deal((select id from ids where k = 'd'), 2, '{"expected_close_time":"14:30"}'), 3, 'the optional close time can be set');

select throws_ok(format($$select public.update_deal(%L, 1, '{"sector":"Late"}')$$, (select id from ids where k = 'd')),
  'DP409', 'stale version', 'a stale version is refused (409)');
select throws_ok(format($$select public.update_deal(%L, 3, '{"stage":"closed"}')$$, (select id from ids where k = 'd')),
  '22023', 'unsupported field: stage', 'stage is not editable here');
select throws_ok(format($$select public.update_deal(%L, 3, '{"tenant_id":"bbbbbbbb-0000-4000-8000-00000000000b"}')$$, (select id from ids where k = 'd')),
  '22023', 'unsupported field: tenant_id', 'the tenant cannot be changed');
select throws_ok(format($$select public.update_deal(%L, 3, '{}')$$, (select id from ids where k = 'd')),
  '22023', 'no changes', 'an empty change is refused');
select throws_ok(format($$select public.update_deal(%L, 3, '{"amount":"12.5"}')$$, (select id from ids where k = 'd')),
  '22023', 'invalid amount', 'an amount must be an integer string, never a float');
select throws_ok(format($$select public.update_deal(%L, 3, '{"amount":"-5"}')$$, (select id from ids where k = 'd')),
  '23514', null, 'a negative amount is refused');
select throws_ok(format($$select public.update_deal(%L, 2, '{"sector":null}')$$, (select id from ids where k = 'scr')),
  'DP422', 'missing required fields: sector', 'a field the current stage requires cannot be removed');
select throws_ok(format($$select public.update_deal(%L, 1, '{"name":"x"}')$$, (select id from ids where k = 'arch')),
  '55000', 'deal is archived', 'an archived deal cannot be edited');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select throws_ok(format($$select public.update_deal(%L, 3, '{"name":"x"}')$$, (select id from ids where k = 'd')),
  '42501', 'permission denied', 'an observer cannot edit');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select throws_ok(format($$select public.update_deal(%L, 3, '{"name":"x"}')$$, (select id from ids where k = 'd')),
  'P0002', 'deal not found', 'a user of another tenant cannot tell the deal exists');
select ok(has_function_privilege('authenticated', 'public.update_deal(uuid,integer,jsonb)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.update_deal(uuid,integer,jsonb)', 'EXECUTE'), 'update_deal is for authenticated only');

select * from finish();
rollback;
