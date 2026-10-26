-- Feature 01, slice 1: the deal_events ledger is append-only, attributed by the database,
-- hash-chained, and tamper-evident. Written before the migration (tests first).
begin;
select plan(24);

-- Fixtures: one tenant, one member, one deal ----------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@example.test');
insert into public.tenants (id, name) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A');
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.deals (id, tenant_id, name) values
  ('cccccccc-0000-4000-8000-0000000000da', 'bbbbbbbb-0000-4000-8000-00000000000a', 'Deal A');

-- Attribution: the client supplies a forged author and timestamp; the database ignores both.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into public.deal_events (id, tenant_id, deal_id, kind, body, actor_id, created_at) values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-0000000000da',
   'note', 'first', 'aaaaaaaa-0000-4000-8000-000000000002', '2000-01-01');
insert into public.deal_events (id, tenant_id, deal_id, kind, body) values
  ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-0000000000da',
   'note', 'second');

select is((select actor_id from public.deal_events where body = 'first'), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'author is auth.uid(), not the value the client sent');
select ok((select created_at >= now() - interval '1 minute' from public.deal_events where body = 'first'),
  'created_at is set by the database, not the client');
select is((select actor_email from public.deal_events where body = 'first'), 'u1@example.test',
  'the actor email is snapshotted into the event');

-- Hash chain ----------------------------------------------------------------------------------------------
select ok((select prev_hash is null from public.deal_events where body = 'first'), 'the first event has no previous hash');
select is((select prev_hash from public.deal_events where body = 'second'), (select hash from public.deal_events where body = 'first'),
  'the second event chains to the first');
select ok((select bool_and(hash ~ '^[0-9a-f]{64}$') from public.deal_events), 'every hash is a sha256 hex digest');
select ok(public.verify_ledger('cccccccc-0000-4000-8000-0000000000da'), 'verify_ledger accepts an untouched chain');

-- Append-only for every role, including the superuser/table owner (row and TRUNCATE triggers) ------
select throws_ok($$update public.deal_events set body = 'x'$$, 'P0001', 'deal_events is append-only', 'superuser/owner cannot UPDATE');
select throws_ok($$delete from public.deal_events$$, 'P0001', 'deal_events is append-only', 'superuser/owner cannot DELETE');
select throws_ok($$truncate public.deal_events$$, 'P0001', 'deal_events is append-only', 'superuser/owner cannot TRUNCATE');

set local role service_role;
select throws_ok($$update public.deal_events set body = 'x'$$, '42501', null, 'service_role cannot UPDATE');
select throws_ok($$delete from public.deal_events$$, '42501', null, 'service_role cannot DELETE');
select throws_ok($$truncate public.deal_events$$, '42501', null, 'service_role cannot TRUNCATE');
reset role;

set local role authenticated;
select throws_ok($$update public.deal_events set body = 'x'$$, '42501', null, 'authenticated cannot UPDATE');
select throws_ok($$delete from public.deal_events$$, '42501', null, 'authenticated cannot DELETE');
select throws_ok($$insert into public.deal_events (tenant_id, deal_id, kind, body) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-0000000000da', 'note', 'direct')$$,
  '42501', null, 'authenticated cannot INSERT directly (post_event is the only way in)');
reset role;

-- No cascades: parents with history cannot be deleted --------------------------------------------------
select throws_ok($$delete from public.deals where id = 'cccccccc-0000-4000-8000-0000000000da'$$, '23503', null, 'a deal with events cannot be deleted (RESTRICT)');
select throws_ok($$delete from public.tenants where id = 'bbbbbbbb-0000-4000-8000-00000000000a'$$, '23503', null, 'a tenant with deals cannot be deleted (RESTRICT)');
select has_column('public', 'deals', 'archived_at', 'deals are soft-deleted through archived_at');

-- The write path ---------------------------------------------------------------------------------------------
select has_function('public', 'post_event', array['uuid', 'text', 'text'], 'post_event(deal, kind, body) exists');
select ok(has_function_privilege('authenticated', 'public.post_event(uuid,text,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.post_event(uuid,text,text)', 'EXECUTE'),
  'post_event is executable by authenticated and not by anon');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.post_event('cccccccc-0000-4000-8000-0000000000da', 'note', 'from a non-member')$$,
  'P0002', 'deal not found', 'a non-member cannot post to a deal, and cannot tell it exists');
reset role;

-- Tamper evidence: an out-of-band edit (triggers disabled by a superuser) is detected --------------------------
select lives_ok($$
  alter table public.deal_events disable trigger user;
  update public.deal_events set body = 'tampered' where body = 'first';
  alter table public.deal_events enable trigger user
$$, 'a superuser can edit a row out of band by disabling triggers (the documented limit)');
select ok(not public.verify_ledger('cccccccc-0000-4000-8000-0000000000da'), 'verify_ledger detects the edit');

select * from finish();
rollback;
