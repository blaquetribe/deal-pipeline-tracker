-- Feature 02: pending invitations are visible only to callers with member.manage.
begin;
select plan(7);

select has_function('public', 'pending_invitations', array['uuid'], 'pending_invitations(tenant) exists');
select ok(has_function_privilege('authenticated', 'public.pending_invitations(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.pending_invitations(uuid)', 'EXECUTE')
      and not has_function_privilege('public', 'public.pending_invitations(uuid)', 'EXECUTE'),
  'only authenticated users can execute the listing function');

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@example.test');
insert into public.tenants (id, name) values
  ('bbbbbbbb-0000-4000-8000-000000000021', 'Alpha'),
  ('bbbbbbbb-0000-4000-8000-000000000022', 'Beta');
select app.seed_system_roles(id) from public.tenants where id in ('bbbbbbbb-0000-4000-8000-000000000021', 'bbbbbbbb-0000-4000-8000-000000000022');
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000021'),
  ('bbbbbbbb-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000022');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from public.memberships m join public.roles r on r.tenant_id = m.tenant_id
where (m.user_id = 'aaaaaaaa-0000-4000-8000-000000000021' and r.key = 'owner')
   or (m.user_id = 'aaaaaaaa-0000-4000-8000-000000000022' and r.key = 'deal_member');
insert into public.invitations (tenant_id, email, role_key, token_hash, invited_by, expires_at, revoked_at)
values
  ('bbbbbbbb-0000-4000-8000-000000000021', 'pending@example.test', 'deal_member', repeat('1', 64), 'aaaaaaaa-0000-4000-8000-000000000021', now() + interval '1 day', null),
  ('bbbbbbbb-0000-4000-8000-000000000021', 'expired@example.test', 'deal_member', repeat('2', 64), 'aaaaaaaa-0000-4000-8000-000000000021', now() - interval '1 day', null),
  ('bbbbbbbb-0000-4000-8000-000000000021', 'revoked@example.test', 'deal_member', repeat('3', 64), 'aaaaaaaa-0000-4000-8000-000000000021', now() + interval '1 day', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000021","role":"authenticated"}', true);
select is((select count(*) from public.pending_invitations('bbbbbbbb-0000-4000-8000-000000000021')), 1::bigint,
  'an Owner sees only pending, unexpired invitations for that tenant');
select is((select invite_email from public.pending_invitations('bbbbbbbb-0000-4000-8000-000000000021')),
  'pending@example.test', 'the result includes the invited email');
select throws_ok($$select * from public.pending_invitations('bbbbbbbb-0000-4000-8000-000000000022')$$,
  '42501', 'permission denied', 'membership in one tenant cannot expose another tenant’s invitations');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000022","role":"authenticated"}', true);
select throws_ok($$select * from public.pending_invitations('bbbbbbbb-0000-4000-8000-000000000021')$$,
  '42501', 'permission denied', 'a member without member.manage cannot list invitations');
reset role;

set local role anon;
select throws_ok($$select * from public.pending_invitations('bbbbbbbb-0000-4000-8000-000000000021')$$,
  '42501', null, 'anonymous users cannot call the function');
reset role;

select * from finish();
rollback;
