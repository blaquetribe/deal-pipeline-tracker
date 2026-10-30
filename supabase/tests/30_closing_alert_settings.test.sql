-- Feature 05: alert preferences are tenant-scoped and writable by authorised tenant managers.
begin;
select plan(16);

select has_function('public', 'get_closing_alert_settings', array['uuid'],
  'tenant managers can read alert settings');
select has_function('public', 'update_closing_alert_settings', array['uuid', 'integer[]', 'boolean', 'text'],
  'tenant managers can update alert settings');
select ok(
  has_function_privilege('authenticated', 'public.get_closing_alert_settings(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_closing_alert_settings(uuid,integer[],boolean,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_closing_alert_settings(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.update_closing_alert_settings(uuid,integer[],boolean,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.update_closing_alert_settings(uuid,integer[],boolean,text)', 'EXECUTE'),
  'settings RPCs are restricted to authenticated callers');

insert into auth.users (id, instance_id, aud, role, email) values
  ('30303030-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alerts-owner@example.test'),
  ('30303030-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alerts-admin@example.test'),
  ('30303030-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alerts-lead@example.test');
insert into public.tenants (id, name) values
  ('30303030-0000-4000-8000-00000000000a', 'Alert settings tenant A'),
  ('30303030-0000-4000-8000-00000000000b', 'Alert settings tenant B');
select app.seed_system_roles(id) from public.tenants
where id in ('30303030-0000-4000-8000-00000000000a', '30303030-0000-4000-8000-00000000000b');
insert into public.memberships (tenant_id, user_id) values
  ('30303030-0000-4000-8000-00000000000a', '30303030-0000-4000-8000-000000000001'),
  ('30303030-0000-4000-8000-00000000000a', '30303030-0000-4000-8000-000000000002'),
  ('30303030-0000-4000-8000-00000000000a', '30303030-0000-4000-8000-000000000003'),
  ('30303030-0000-4000-8000-00000000000b', '30303030-0000-4000-8000-000000000001');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from (values
  ('30303030-0000-4000-8000-00000000000a'::uuid, '30303030-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('30303030-0000-4000-8000-00000000000a', '30303030-0000-4000-8000-000000000002', 'admin'),
  ('30303030-0000-4000-8000-00000000000a', '30303030-0000-4000-8000-000000000003', 'deal_lead'),
  ('30303030-0000-4000-8000-00000000000b', '30303030-0000-4000-8000-000000000001', 'owner')
) as fixture(tenant_id, user_id, role_key)
join public.memberships m on m.tenant_id = fixture.tenant_id and m.user_id = fixture.user_id
join public.roles r on r.tenant_id = fixture.tenant_id and r.key = fixture.role_key;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000001"}', true);
select is(public.get_closing_alert_settings('30303030-0000-4000-8000-00000000000a'),
  '{"alertDays":[5,1],"alertOnOverdue":true,"extraRecipients":"none"}'::jsonb,
  'Owner reads the default alert preferences');
select lives_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[10, 5, 1], false, 'ic')$$,
  'Owner can update alert preferences');
select is((select alert_days from public.tenants where id = '30303030-0000-4000-8000-00000000000a'),
  array[10, 5, 1], 'thresholds are persisted in the supplied priority order');
select is((select alert_on_overdue and alert_extra_recipients = 'ic' from public.tenants
  where id = '30303030-0000-4000-8000-00000000000a'), false,
  'overdue and additional-recipient choices are persisted');
select is((select count(*) from public.tenant_events where tenant_id = '30303030-0000-4000-8000-00000000000a'
  and kind = 'settings_changed'), 1::bigint, 'preference changes are recorded in the append-only tenant trail');
select throws_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[5, 5], true, 'none')$$,
  '22023', 'invalid alert preferences', 'duplicate thresholds are rejected');
select throws_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[366], true, 'none')$$,
  '22023', 'invalid alert preferences', 'thresholds are limited to 365 days');
select throws_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[5], true, 'everyone')$$,
  '22023', 'invalid alert preferences', 'extra recipients must use the supported choices');
select lives_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[]::integer[], true, 'none')$$,
  'Owner can disable all pre-close reminders while keeping overdue alerts');
select is((select alert_days from public.tenants where id = '30303030-0000-4000-8000-00000000000a'),
  array[]::integer[], 'empty threshold list is stored');

select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000002"}', true);
select lives_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[5, 1], true, 'all')$$,
  'Admin can update alert preferences');
select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000003"}', true);
select throws_ok($$select public.update_closing_alert_settings(
  '30303030-0000-4000-8000-00000000000a', array[5, 1], true, 'none')$$,
  '42501', 'permission denied', 'ordinary members cannot change alert preferences');
select throws_ok($$select public.get_closing_alert_settings('30303030-0000-4000-8000-00000000000b')$$,
  '42501', 'permission denied', 'a tenant manager cannot read another tenant settings');
reset role;
select * from finish();
rollback;
