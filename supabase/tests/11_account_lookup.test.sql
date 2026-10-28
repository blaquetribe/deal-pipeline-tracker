-- Feature 02, slice C: the one account lookup the API needs without a user JWT (resend verification,
-- password reset). It reveals nothing a signed-out visitor could not already cause to be emailed.
begin;
select plan(8);

select has_function('public', 'account_lookup', array['text'], 'account_lookup(email) exists');
select ok(has_function_privilege('api_service', 'public.account_lookup(text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.account_lookup(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.account_lookup(text)', 'EXECUTE'),
  'only api_service can call it');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verified@example.test', now()),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending@example.test', null);
grant usage on schema extensions to api_service;  -- pgTAP only; production does not grant this

set local role api_service;
select is((select user_id from public.account_lookup('verified@example.test')), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'finds a verified account');
select is((select email_verified from public.account_lookup('verified@example.test')), true, 'and says it is verified');
select is((select email_verified from public.account_lookup('pending@example.test')), false, 'finds an unverified account and says so');
select is((select user_id from public.account_lookup('  VERIFIED@Example.TEST ')), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'ignores case and surrounding spaces');
select is((select count(*) from public.account_lookup('nobody@example.test')), 0::bigint, 'an unknown email finds nothing');
select is((select count(*) from public.account_lookup('%')), 0::bigint, 'and a wildcard is not a pattern');
reset role;

select * from finish();
rollback;
