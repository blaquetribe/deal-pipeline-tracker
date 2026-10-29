-- Feature 02: refresh-token rotation is serialized across API instances by a short DB lease.
begin;
select plan(11);

select ok(has_function_privilege('api_service',
  'public.session_refresh_claim(text,text,integer)', 'EXECUTE'), 'api_service can claim refresh leases');
select ok(not has_function_privilege('authenticated',
  'public.session_refresh_claim(text,text,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.session_refresh_claim(text,text,integer)', 'EXECUTE'),
  'authenticated and anon cannot claim refresh leases');
select ok(not has_table_privilege('api_service', 'public.api_sessions', 'SELECT,INSERT,UPDATE,DELETE'),
  'api_service still has no direct session table privileges');
select ok(not has_function_privilege('api_service', 'public.session_update_tokens(text,bytea)', 'EXECUTE'),
  'the uncoordinated token update function is disabled for api_service');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('29292929-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'refresh-lease@example.test', now());

grant usage on schema extensions to api_service;
set local role api_service;
select public.session_create(repeat('9', 64), '29292929-0000-4000-8000-000000000001', '\x0102');

select ok((select claimed from public.session_refresh_claim(repeat('9', 64), repeat('a', 64), 20000)) is true,
  'first API instance claims the refresh lease');
select ok((select claimed from public.session_refresh_claim(repeat('9', 64), repeat('b', 64), 20000)) is false,
  'a second API instance cannot claim an active lease');
select is((select tokens_enc from public.session_refresh_claim(repeat('9', 64), repeat('b', 64), 20000)),
  '\x0102'::bytea, 'a competing instance receives only the encrypted current tokens');
select ok(public.session_refresh_complete(repeat('9', 64), repeat('b', 64), '\x0304') is false,
  'a competing instance cannot complete another instance claim');
select ok(public.session_refresh_complete(repeat('9', 64), repeat('a', 64), '\x0304') is true,
  'the lease owner can atomically rotate tokens and release its claim');
select is((select tokens_enc from public.session_lookup(repeat('9', 64))), '\x0304'::bytea,
  'subsequent session reads see the rotated tokens');
select throws_ok($$select * from public.session_refresh_claim(repeat('9', 64), repeat('c', 64), 0)$$,
  '22023', 'invalid refresh claim', 'lease duration is bounded');

select * from finish();
rollback;
