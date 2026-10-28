-- Feature 03: dashboard summaries are tenant-authorized, currency-safe and timezone-aware.
begin;
select plan(12);

select has_function('public', 'deal_dashboard_summary', array['uuid'], 'dashboard summary RPC exists');
select ok(
  has_function_privilege('authenticated', 'public.deal_dashboard_summary(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.deal_dashboard_summary(uuid)', 'EXECUTE'),
  'dashboard summary is executable by authenticated and not anon'
);
insert into auth.users (id, instance_id, aud, role, email) values
  ('20202020-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'summary-owner@example.test'),
  ('20202020-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'summary-other@example.test');
insert into public.tenants (id, name, timezone, closing_soon_days) values
  ('20202020-0000-4000-8000-00000000000a', 'Summary tenant A', 'Asia/Tokyo', 60),
  ('20202020-0000-4000-8000-00000000000b', 'Summary tenant B', 'Africa/Johannesburg', 60);
select app.seed_system_roles(id) from public.tenants where id in (
  '20202020-0000-4000-8000-00000000000a', '20202020-0000-4000-8000-00000000000b'
);
insert into public.memberships (tenant_id, user_id) values
  ('20202020-0000-4000-8000-00000000000a', '20202020-0000-4000-8000-000000000001'),
  ('20202020-0000-4000-8000-00000000000b', '20202020-0000-4000-8000-000000000002');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = 'owner'
on conflict (membership_id, role_id) do nothing;
create temporary table summary_ids (deal_id uuid);
grant all on summary_ids to public;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20202020-0000-4000-8000-000000000001"}', true);
insert into summary_ids values
  (public.create_deal('20202020-0000-4000-8000-00000000000a', 'Tokyo closing deal', 'Energy', 1234, 'ZAR',
    ((statement_timestamp() at time zone 'Asia/Tokyo')::date + 1))),
  (public.create_deal('20202020-0000-4000-8000-00000000000a', 'Undated euro deal', 'Energy', 750, 'EUR', null)),
  (public.create_deal('20202020-0000-4000-8000-00000000000a', 'Second rand deal', 'Energy', 500, 'ZAR', null));
select public.update_deal((select deal_id from summary_ids limit 1), 1, '{"expected_close_time":"14:30"}'::jsonb);

select is(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')->>'timeZone', 'Asia/Tokyo',
  'summary uses the tenant time zone');
select is(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')->>'windowDays', '60',
  'summary uses the tenant window');
select is(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')#>>'{pipelineByStage,0,count}', '3',
  'pipeline count includes all current deals in stage order');
select is(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')#>>'{totalsByCurrency,1,amount}', '1734',
  'same-currency pipeline total is an exact integer string');
select is(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')->>'closingSoonCount', '1',
  'only deals with a close date inside the window enter closing soon');
select is(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')#>>'{closingSoon,0,closesInDays}', '1',
  'close-day distance uses the tenant calendar date');
select is(to_char(((public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')
  #>>'{closingSoon,0,closesAt}')::timestamptz at time zone 'Asia/Tokyo')::time, 'HH24:MI'), '14:30',
  'close time is interpreted in the tenant time zone');
select ok(public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')->>'nextMidnightAt' is not null,
  'summary supplies the next tenant-local midnight for aligned countdown updates');
select set_config('request.jwt.claims', '{"sub":"20202020-0000-4000-8000-000000000002"}', true);
select throws_ok($$select public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')$$,
  '42501', 'permission denied', 'another tenant cannot read the dashboard summary');
reset role;
set local role anon;
select throws_ok($$select public.deal_dashboard_summary('20202020-0000-4000-8000-00000000000a')$$,
  '42501', null, 'anonymous users cannot call the dashboard summary');
reset role;

select * from finish();
rollback;
