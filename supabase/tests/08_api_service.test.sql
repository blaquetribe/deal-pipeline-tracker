-- Feature 02, slice A: the narrow api_service role, server-side sessions, single-use email tokens and
-- tenant-scoped profiles (ADR 0015). Written before the migration.
begin;
select plan(46);

-- The role and its surface ----------------------------------------------------------------------------------
select has_role('api_service', 'api_service exists');
select ok(pg_has_role('authenticator', 'api_service', 'member'), 'PostgREST (authenticator) can switch to api_service');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app', 'auth') and c.relkind in ('r', 'v', 'm', 'p')
      and has_table_privilege('api_service', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'api_service has no table privilege anywhere: only functions'
);
select set_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('api_service', p.oid, 'EXECUTE')$$,
  $$values ('session_create'), ('session_lookup'), ('session_update_tokens'), ('session_set_tenant'),
           ('session_revoke'), ('session_revoke_user'), ('token_issue'), ('token_consume'),
           ('invitation_preview'), ('invitation_accept'), ('account_lookup')$$,
  'api_service can execute exactly the session, token and invitation functions'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'session\_%' or p.proname like 'token\_%')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0::bigint, 'users, anon and PUBLIC cannot execute any of them'
);
select is(
  (select count(*) from unnest(array['api_sessions', 'email_tokens']) as t(name)
    where not (select relrowsecurity and relforcerowsecurity from pg_class where oid = to_regclass('public.' || t.name))
       or has_table_privilege('authenticated', to_regclass('public.' || t.name), 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('anon', to_regclass('public.' || t.name), 'SELECT,INSERT,UPDATE,DELETE')),
  0::bigint, 'api_sessions and email_tokens: RLS forced, no access for users or anon'
);

-- Fixtures ----------------------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@example.test', case when n = 4 then null else now() end
from generate_series(1, 5) as n;
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A'), ('bbbbbbbb-0000-4000-8000-00000000000b', 'Tenant B');
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000003');
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
-- pgTAP lives in the extensions schema; api_service is not given it in production, only inside this rolled-back test.
grant usage on schema extensions to api_service;

-- Sessions: the API sends a sha256 of the opaque cookie value, never the value ----------------------------------------------
set local role api_service;
select lives_ok($$select public.session_create(repeat('a', 64), 'aaaaaaaa-0000-4000-8000-000000000001', '\x0102')$$, 'a session is created for a verified user');
select is((select user_id from public.session_lookup(repeat('a', 64))), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'and found by its hash');
select is((select tokens_enc from public.session_lookup(repeat('a', 64))), '\x0102'::bytea, 'the stored tokens come back as stored (the API encrypts them)');
select is((select count(*) from public.session_lookup(repeat('b', 64))), 0::bigint, 'an unknown hash finds nothing');
select throws_ok($$select public.session_create('not-a-hash', 'aaaaaaaa-0000-4000-8000-000000000001', '\x01')$$, '22023', 'invalid session hash', 'only a sha256 hex digest is accepted');
select throws_ok($$select public.session_create(repeat('a', 64), 'aaaaaaaa-0000-4000-8000-000000000001', '\x01')$$, '23505', null, 'a hash cannot be reused');
select throws_ok($$select public.session_create(repeat('c', 64), 'aaaaaaaa-0000-4000-8000-000000000004', '\x01')$$, '42501', 'email not verified', 'an unverified user gets no session');
select lives_ok($$select public.session_update_tokens(repeat('a', 64), '\x0304')$$, 'refreshed tokens can be stored');
select is((select tokens_enc from public.session_lookup(repeat('a', 64))), '\x0304'::bytea, 'and replace the old ones');

select is((select active_tenant_id from public.session_lookup(repeat('a', 64))), null::uuid, 'no tenant is active until one is chosen');
select lives_ok($$select public.session_set_tenant(repeat('a', 64), 'bbbbbbbb-0000-4000-8000-00000000000a')$$, 'a member can activate their tenant');
select is((select active_tenant_id from public.session_lookup(repeat('a', 64))), 'bbbbbbbb-0000-4000-8000-00000000000a'::uuid, 'and it is remembered');
select throws_ok($$select public.session_set_tenant(repeat('a', 64), 'bbbbbbbb-0000-4000-8000-00000000000b')$$, '42501', 'not a member', 'a tenant the user does not belong to cannot be activated');

select lives_ok($$select public.session_revoke(repeat('a', 64))$$, 'a session can be revoked');
select is((select count(*) from public.session_lookup(repeat('a', 64))), 0::bigint, 'and is then gone');

select public.session_create(repeat('d', 64), 'aaaaaaaa-0000-4000-8000-000000000002', '\x01');
select public.session_create(repeat('e', 64), 'aaaaaaaa-0000-4000-8000-000000000002', '\x01');
select is(public.session_revoke_user('aaaaaaaa-0000-4000-8000-000000000002'), 2, 'revoking a user ends every session they have');
select is((select count(*) from public.session_lookup(repeat('d', 64))) + (select count(*) from public.session_lookup(repeat('e', 64))), 0::bigint, 'and none can be found');

select public.session_create(repeat('f', 64), 'aaaaaaaa-0000-4000-8000-000000000001', '\x01');
reset role;
update public.api_sessions set expires_at = now() - interval '1 second' where session_hash = repeat('f', 64);
set local role api_service;
select is((select count(*) from public.session_lookup(repeat('f', 64))), 0::bigint, 'an expired session finds nothing');
select throws_ok($$select public.session_update_tokens(repeat('f', 64), '\x09')$$, '42501', 'no active session', 'and cannot be refreshed');

select public.session_create(repeat('9', 64), 'aaaaaaaa-0000-4000-8000-000000000002', '\x01');
reset role;
update public.memberships set deactivated_at = now() where user_id = 'aaaaaaaa-0000-4000-8000-000000000002';
set local role api_service;
select throws_ok($$select public.session_set_tenant(repeat('9', 64), 'bbbbbbbb-0000-4000-8000-00000000000a')$$, '42501', 'not a member', 'a deactivated member cannot activate a tenant');
reset role;

-- Users cannot call the session functions ---------------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$select public.session_lookup(repeat('a', 64))$$, '42501', null, 'a signed-in user cannot look up sessions');
reset role;

-- Email tokens ---------------------------------------------------------------------------------------------------------------------
set local role api_service;
insert into ids select 't1', public.token_issue('verify_email', 'aaaaaaaa-0000-4000-8000-000000000004', repeat('1', 64));
select ok((select id from ids where k = 't1') is not null, 'a verification token is issued');
reset role;
select ok((select expires_at between now() + interval '23 hours' and now() + interval '25 hours' from public.email_tokens where id = (select id from ids where k = 't1')),
  'it expires in 24 hours');
select ok((select email_confirmed_at is null from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000004'), 'issuing does not verify the email');
set local role api_service;
select is(public.token_consume('verify_email', repeat('1', 64)), 'aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'consuming returns the user');
reset role;
select ok((select email_confirmed_at is not null from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000004'), 'and verifies the email, atomically with the consumption');
set local role api_service;
select throws_ok($$select public.token_consume('verify_email', repeat('1', 64))$$, 'DP401', 'invalid token', 'a token works once');
select throws_ok($$select public.token_consume('verify_email', repeat('2', 64))$$, 'DP401', 'invalid token', 'an unknown token gives the same answer');
select throws_ok($$select public.token_consume('bogus', repeat('1', 64))$$, '22023', null, 'an unknown purpose is refused');

select public.token_issue('reset_password', 'aaaaaaaa-0000-4000-8000-000000000001', repeat('3', 64));
select throws_ok($$select public.token_consume('verify_email', repeat('3', 64))$$, 'DP401', 'invalid token', 'a token is bound to its purpose');
select public.token_issue('reset_password', 'aaaaaaaa-0000-4000-8000-000000000001', repeat('4', 64));
select throws_ok($$select public.token_consume('reset_password', repeat('3', 64))$$, 'DP401', 'invalid token', 'resending invalidates the earlier token');
select is(public.token_consume('reset_password', repeat('4', 64)), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'and the newest one works');

select public.token_issue('reset_password', 'aaaaaaaa-0000-4000-8000-000000000001', repeat('5', 64));
reset role;
update public.email_tokens set expires_at = now() - interval '1 second' where token_hash = repeat('5', 64);
set local role api_service;
select throws_ok($$select public.token_consume('reset_password', repeat('5', 64))$$, 'DP401', 'invalid token', 'an expired token gives the same answer');

select public.token_issue('reset_password', 'aaaaaaaa-0000-4000-8000-000000000001', repeat('6', 64));
reset role;
update auth.users set email = 'changed@example.test' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role api_service;
select throws_ok($$select public.token_consume('reset_password', repeat('6', 64))$$, 'DP401', 'invalid token', 'a token dies when the account email changes (email-bound)');
reset role;
select is((select count(*) from public.email_tokens where token_hash like '%not-a-hash%'), 0::bigint, 'only hashes are stored');

-- Profiles: a tenant-scoped directory -----------------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select lives_ok($$select public.profile_upsert('Ada Lovelace', 'Partner')$$, 'a user can write their own profile');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select public.profile_upsert('Other Tenant', null);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select is((select display_name from public.profiles where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'Ada Lovelace', 'and read it back');
select is((select count(*) from public.profiles where user_id = 'aaaaaaaa-0000-4000-8000-000000000003'), 0::bigint, 'but not the profile of someone in no shared tenant');
select throws_ok($$update public.profiles set display_name = 'x'$$, '42501', null, 'profiles are written only through the function');
select throws_ok($$select public.profile_upsert('', null)$$, '23514', null, 'a profile needs a name');
reset role;

select * from finish();
rollback;
