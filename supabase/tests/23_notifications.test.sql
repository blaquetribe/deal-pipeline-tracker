-- Feature 05: notification storage is visible only to its recipient and cannot be written directly.
begin;
select plan(27);

select has_table('public', 'notifications', 'notifications table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'notifications enables and forces row-level security');
select has_function('public', 'mark_notification_read', array['uuid'], 'recipient-scoped read RPC exists');
select has_function('public', 'list_notifications', array['uuid', 'integer'], 'notification list RPC exists');
select has_function('public', 'scan_closing_soon', array['timestamp with time zone'], 'closing-soon scanner exists');
select has_table('public', 'email_outbox', 'email outbox table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.email_outbox'::regclass),
  'email outbox enables and forces row-level security');
select has_function('public', 'claim_closing_soon_emails', array['integer'], 'private email claim function exists');
select has_function('public', 'complete_closing_soon_emails', array['uuid[]', 'boolean'], 'email completion function exists');
select ok(not has_function_privilege('public', 'public.scan_closing_soon(timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.scan_closing_soon(timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.scan_closing_soon(timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('api_service', 'public.scan_closing_soon(timestamp with time zone)', 'EXECUTE'),
  'the scheduler function is not callable through PostgREST');
select ok(has_table_privilege('authenticated', 'public.notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('api_service', 'public.notifications', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('authenticated', 'public.email_outbox', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('api_service', 'public.email_outbox', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  and has_function_privilege('api_service', 'public.claim_closing_soon_emails(integer)', 'EXECUTE')
  and has_function_privilege('api_service', 'public.complete_closing_soon_emails(uuid[],boolean)', 'EXECUTE')
  and not has_function_privilege('public', 'public.claim_closing_soon_emails(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_closing_soon_emails(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_closing_soon_emails(integer)', 'EXECUTE'),
  'notification and email data stay table-private; only api_service can claim and finish email');

insert into auth.users (id, instance_id, aud, role, email) values
  ('23232323-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notification-a@example.test'),
  ('23232323-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notification-b@example.test'),
  ('23232323-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'notification-c@example.test');
insert into public.tenants (id, name) values
  ('23232323-0000-4000-8000-00000000000a', 'Notification tenant A'),
  ('23232323-0000-4000-8000-00000000000b', 'Notification tenant B');
insert into public.memberships (tenant_id, user_id) values
  ('23232323-0000-4000-8000-00000000000a', '23232323-0000-4000-8000-000000000001'),
  ('23232323-0000-4000-8000-00000000000a', '23232323-0000-4000-8000-000000000002'),
  ('23232323-0000-4000-8000-00000000000b', '23232323-0000-4000-8000-000000000003');
insert into public.deals (id, tenant_id, name) values
  ('23232323-0000-4000-8000-0000000000d1', '23232323-0000-4000-8000-00000000000a', 'Notification deal A'),
  ('23232323-0000-4000-8000-0000000000d2', '23232323-0000-4000-8000-00000000000b', 'Notification deal B');
insert into public.notifications (id, tenant_id, user_id, kind, deal_id, dedupe_key, payload) values
  ('23232323-0000-4000-8000-0000000000e1', '23232323-0000-4000-8000-00000000000a', '23232323-0000-4000-8000-000000000001', 'closing_soon', '23232323-0000-4000-8000-0000000000d1', 'test:a', '{"message":"A"}'),
  ('23232323-0000-4000-8000-0000000000e2', '23232323-0000-4000-8000-00000000000a', '23232323-0000-4000-8000-000000000002', 'closing_soon', '23232323-0000-4000-8000-0000000000d1', 'test:b', '{"message":"B"}'),
  ('23232323-0000-4000-8000-0000000000e3', '23232323-0000-4000-8000-00000000000b', '23232323-0000-4000-8000-000000000003', 'closing_soon', '23232323-0000-4000-8000-0000000000d2', 'test:c', '{"message":"C"}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23232323-0000-4000-8000-000000000001"}', true);
select is((select count(*) from public.notifications), 1::bigint, 'recipient sees only their own notifications');
select is((select count(*) from public.list_notifications('23232323-0000-4000-8000-00000000000a', 50)), 1::bigint,
  'notification list RPC returns only the active tenant recipient feed');
select is((select count(*) from public.notifications where tenant_id = '23232323-0000-4000-8000-00000000000b'), 0::bigint,
  'recipient cannot read notifications from another tenant');
select throws_ok($$insert into public.notifications (tenant_id, user_id, kind, dedupe_key, payload)
  values ('23232323-0000-4000-8000-00000000000a', '23232323-0000-4000-8000-000000000001', 'closing_soon', 'direct', '{}')$$,
  '42501', null, 'recipient cannot create a notification directly');
select throws_ok($$update public.notifications set read_at = now() where id = '23232323-0000-4000-8000-0000000000e1'$$,
  '42501', null, 'recipient cannot alter notification state directly');
select set_config('request.jwt.claims', '{"sub":"23232323-0000-4000-8000-000000000002"}', true);
select is((select count(*) from public.notifications), 1::bigint, 'a different same-tenant user sees only their own notification');
select throws_ok($$select public.mark_notification_read('23232323-0000-4000-8000-0000000000e1')$$,
  'P0002', 'notification not found', 'a different recipient cannot mark another notification read');
reset role;
select set_config('request.jwt.claims', '{}', true);
update public.deals set expected_close_date = current_date + 4 where id = '23232323-0000-4000-8000-0000000000d1';
insert into public.deal_assignees (tenant_id, deal_id, user_id, role) values
  ('23232323-0000-4000-8000-00000000000a', '23232323-0000-4000-8000-0000000000d1', '23232323-0000-4000-8000-000000000001', 'owner');
select is(public.scan_closing_soon((current_date::timestamp + time '12:00') at time zone 'Africa/Johannesburg'), 1,
  'first scan creates one due five-day alert');
select is(public.scan_closing_soon((current_date::timestamp + time '12:00') at time zone 'Africa/Johannesburg'), 0,
  'repeated scan creates no duplicate notification');
select is((select count(*) from public.deal_events where deal_id = '23232323-0000-4000-8000-0000000000d1'
  and kind = 'closing_soon_alert' and actor_kind = 'system' and actor_id is null), 1::bigint,
  'scanner appends one correctly attributed system ledger event');
select is((select count(*) from public.email_outbox where tenant_id = '23232323-0000-4000-8000-00000000000a'
  and user_id = '23232323-0000-4000-8000-000000000001' and status = 'queued'), 1::bigint,
  'new alert creates one queued email digest item per recipient');
create temporary table claimed_email_ids (id uuid primary key);
grant all on claimed_email_ids to api_service;
grant usage on schema extensions to api_service;
set local role api_service;
insert into claimed_email_ids select id from public.claim_closing_soon_emails(10);
select is((select count(*) from claimed_email_ids), 1::bigint, 'api_service claims only due email items');
select is(public.complete_closing_soon_emails((select array_agg(id) from claimed_email_ids), true), 1,
  'api_service completes the claimed email batch');
reset role;
select is((select status from public.email_outbox where id = (select id from claimed_email_ids)), 'sent',
  'completed digest items are marked sent');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"23232323-0000-4000-8000-000000000001"}', true);
select is(public.mark_notification_read('23232323-0000-4000-8000-0000000000e1'), true,
  'the recipient can mark their own notification read through the scoped RPC');
select ok((select read_at is not null from public.notifications where id = '23232323-0000-4000-8000-0000000000e1'),
  'read state is persisted for that recipient');
reset role;
select * from finish();
rollback;
