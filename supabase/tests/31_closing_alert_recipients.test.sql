-- Feature 05: alerts cover assigned teams, active approval delegates, fallbacks and chosen extras.
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email) values
  ('31313130-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'closing-owner@example.test'),
  ('31313130-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'closing-admin@example.test'),
  ('31313130-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'closing-principal@example.test'),
  ('31313130-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'closing-delegate@example.test'),
  ('31313130-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'closing-extra-ic@example.test'),
  ('31313130-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'closing-team-member@example.test'),
  ('31313130-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'closing-inactive@example.test'),
  ('31313130-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'closing-other-tenant@example.test');
insert into public.tenants (id, name) values
  ('31313130-0000-4000-8000-00000000000a', 'Closing tenant A'),
  ('31313130-0000-4000-8000-00000000000b', 'Closing tenant B');
select app.seed_system_roles(id) from public.tenants
where id in ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-00000000000b');
insert into public.memberships (tenant_id, user_id) values
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000001'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000002'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000003'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000004'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000005'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000006'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-000000000007'),
  ('31313130-0000-4000-8000-00000000000b', '31313130-0000-4000-8000-000000000008');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r
  on r.tenant_id = m.tenant_id and r.key = case m.user_id
    when '31313130-0000-4000-8000-000000000001' then 'owner'
    when '31313130-0000-4000-8000-000000000002' then 'admin'
    when '31313130-0000-4000-8000-000000000003' then 'ic_member'
    when '31313130-0000-4000-8000-000000000004' then 'ic_member'
    when '31313130-0000-4000-8000-000000000005' then 'ic_member'
    else 'deal_team_member' end;
update public.memberships set deactivated_at = now()
where user_id = '31313130-0000-4000-8000-000000000007'
  and tenant_id = '31313130-0000-4000-8000-00000000000a';
insert into public.approval_policies (tenant_id, required_approvals, delegation_enabled)
  values ('31313130-0000-4000-8000-00000000000a', 1, true);
insert into public.approval_delegations
  (tenant_id, delegator_membership_id, delegate_membership_id, starts_at, ends_at)
select principal.tenant_id, principal.id, delegate.id, now() - interval '1 hour', now() + interval '1 day'
from public.memberships principal join public.memberships delegate on delegate.tenant_id = principal.tenant_id
where principal.user_id = '31313130-0000-4000-8000-000000000003'
  and delegate.user_id = '31313130-0000-4000-8000-000000000004'
  and principal.tenant_id = '31313130-0000-4000-8000-00000000000a';
insert into public.approval_absences (tenant_id, membership_id, starts_at, ends_at)
select m.tenant_id, m.id, now() - interval '1 minute', now() + interval '1 hour'
from public.memberships m where m.user_id = '31313130-0000-4000-8000-000000000003'
  and m.tenant_id = '31313130-0000-4000-8000-00000000000a';
insert into public.deals (id, tenant_id, name, stage, amount, currency, expected_close_date) values
  ('31313130-0000-4000-8000-0000000000d1', '31313130-0000-4000-8000-00000000000a', 'Assigned deal', 'sourcing', 100000, 'ZAR', current_date + 4),
  ('31313130-0000-4000-8000-0000000000d2', '31313130-0000-4000-8000-00000000000a', 'Unassigned deal', 'sourcing', 100000, 'ZAR', current_date + 90);
insert into public.deal_assignees (tenant_id, deal_id, user_id, role) values
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-0000000000d1', '31313130-0000-4000-8000-000000000003', 'owner'),
  ('31313130-0000-4000-8000-00000000000a', '31313130-0000-4000-8000-0000000000d1', '31313130-0000-4000-8000-000000000006', 'member');
update public.tenants set alert_days = array[5]::integer[], alert_extra_recipients = 'ic'
where id = '31313130-0000-4000-8000-00000000000a';

-- Isolate this fixture from due dates in the persistent seeded demo tenant.
update public.deals set expected_close_date = current_date + 90
where tenant_id in (
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002'
);
select is(public.scan_closing_soon(now()), 4, 'scanner creates one notification for each resolved recipient');
select is((select array_agg(user_id order by user_id) from public.notifications
  where deal_id = '31313130-0000-4000-8000-0000000000d1'),
  array[
    '31313130-0000-4000-8000-000000000003'::uuid,
    '31313130-0000-4000-8000-000000000004'::uuid,
    '31313130-0000-4000-8000-000000000005'::uuid,
    '31313130-0000-4000-8000-000000000006'::uuid
  ], 'assigned team, absent principal, active delegate and IC extras receive one alert each');
select is((select count(*) from public.email_outbox where deal_id in (
  '31313130-0000-4000-8000-0000000000d1') and status = 'queued'),
  4::bigint, 'each in-app alert has one queued email');
select is(public.scan_closing_soon(now()), 0, 'repeated scan does not duplicate notifications or email');
select is(app.closing_alert_recipients('31313130-0000-4000-8000-00000000000a',
  '31313130-0000-4000-8000-0000000000d1', now(), 'none'),
  array['31313130-0000-4000-8000-000000000003'::uuid,
    '31313130-0000-4000-8000-000000000004'::uuid,
    '31313130-0000-4000-8000-000000000006'::uuid],
  'assigned principals remain notified and an active delegate is added even when the principal is absent');
select is(app.closing_alert_recipients('31313130-0000-4000-8000-00000000000a',
  '31313130-0000-4000-8000-0000000000d2', now(), 'none'),
  array['31313130-0000-4000-8000-000000000001'::uuid,
    '31313130-0000-4000-8000-000000000002'::uuid],
  'unassigned deals fall back to active Owner and Admin');
select is(app.closing_alert_recipients('31313130-0000-4000-8000-00000000000a',
  '31313130-0000-4000-8000-0000000000d2', now(), 'all'),
  array[
    '31313130-0000-4000-8000-000000000001'::uuid,
    '31313130-0000-4000-8000-000000000002'::uuid,
    '31313130-0000-4000-8000-000000000003'::uuid,
    '31313130-0000-4000-8000-000000000004'::uuid,
    '31313130-0000-4000-8000-000000000005'::uuid,
    '31313130-0000-4000-8000-000000000006'::uuid
  ], 'all-members option includes only active users in this tenant');
update public.approval_policies set delegation_enabled = false
where tenant_id = '31313130-0000-4000-8000-00000000000a';
select is(app.closing_alert_recipients('31313130-0000-4000-8000-00000000000a',
  '31313130-0000-4000-8000-0000000000d1', now(), 'none'),
  array['31313130-0000-4000-8000-000000000003'::uuid,
    '31313130-0000-4000-8000-000000000006'::uuid],
  'delegates are excluded when tenant approval delegation is disabled');
select is(array_position(app.closing_alert_recipients('31313130-0000-4000-8000-00000000000a',
  '31313130-0000-4000-8000-0000000000d2', now(), 'all'), '31313130-0000-4000-8000-000000000008'::uuid),
  null::integer, 'recipient expansion never includes another tenant member');

select * from finish();
rollback;
