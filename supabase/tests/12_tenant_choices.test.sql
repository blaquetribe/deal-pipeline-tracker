-- Feature 02: the authenticated tenant switcher can list only the caller's active memberships.
begin;
select plan(7);

select has_function('public', 'tenant_choices', array[]::text[], 'tenant_choices() exists');
select ok(has_function_privilege('authenticated', 'public.tenant_choices()', 'EXECUTE')
      and not has_function_privilege('anon', 'public.tenant_choices()', 'EXECUTE')
      and not has_function_privilege('public', 'public.tenant_choices()', 'EXECUTE'),
  'only authenticated users can execute tenant_choices');

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'switcher@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@example.test');
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000000011', 'Alpha'),
  ('bbbbbbbb-0000-4000-8000-000000000012', 'Beta'),
  ('bbbbbbbb-0000-4000-8000-000000000013', 'Private');
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000011'),
  ('bbbbbbbb-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000011'),
  ('bbbbbbbb-0000-4000-8000-000000000013', 'aaaaaaaa-0000-4000-8000-000000000012');
update public.memberships set deactivated_at = now()
  where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000012';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated"}', true);
select is((select count(*) from public.tenant_choices()), 1::bigint,
  'returns only active memberships and excludes another user’s tenant');
select is((select tenant_name from public.tenant_choices()), 'Alpha', 'returns the tenant name needed by the switcher');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000012","role":"authenticated"}', true);
select is((select tenant_name from public.tenant_choices()), 'Private', 'results follow the authenticated identity');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000099","role":"authenticated"}', true);
select is((select count(*) from public.tenant_choices()), 0::bigint, 'a user with no memberships gets an empty list');
reset role;

set local role anon;
select throws_ok($$select * from public.tenant_choices()$$, '42501', null,
  'anonymous users cannot call tenant_choices');
reset role;

select * from finish();
rollback;
