-- Feature 02, slice B: invitations. Hashed, email-bound, single-use, expiring, capped per tenant, with
-- the same no-escalation rule as grant_role, and an acceptance that is one atomic step. Tests first.
begin;
select plan(37);

-- Structure -----------------------------------------------------------------------------------------------------
select has_table('public', 'invitations', 'invitations exists');
select is(
  (select count(*) from pg_class where oid = to_regclass('public.invitations') and relrowsecurity and relforcerowsecurity)
  + (select count(*) from unnest(array['authenticated', 'anon', 'api_service']) as r(name)
      where has_table_privilege(r.name, to_regclass('public.invitations'), 'INSERT,UPDATE,DELETE,TRUNCATE')),
  1::bigint, 'RLS forced, and nobody has direct write access'
);
select ok(not has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'SELECT')
      and has_column_privilege('authenticated', 'public.invitations', 'email', 'SELECT'),
  'users can list invitations but never read the token hash');

-- Fixtures --------------------------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       (array['u1@example.test', 'u2@example.test', 'u3@example.test', 'new@example.test', 'other@example.test', 'late@example.test'])[n],
       case when n = 6 then null else now() end
from generate_series(1, 6) as n;
insert into public.tenants (id, name) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'Acme Capital');
select app.seed_system_roles(id) from public.tenants where id in ('bbbbbbbb-0000-4000-8000-00000000000a');
insert into public.memberships (tenant_id, user_id) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id
from (values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'owner'), ('aaaaaaaa-0000-4000-8000-000000000002', 'admin'),
             ('aaaaaaaa-0000-4000-8000-000000000003', 'deal_member')) as v(user_id, role_key)
join public.memberships m on m.user_id = v.user_id
join public.roles r on r.tenant_id = m.tenant_id and r.key = v.role_key;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
grant usage on schema extensions to api_service;  -- pgTAP only; production does not grant this

-- Inviting -------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
insert into ids select 'inv', public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'new@example.test', 'deal_lead', repeat('1', 64));
select ok((select id from ids where k = 'inv') is not null, 'the Owner invites someone');
select is((select count(*) from public.tenant_events where kind = 'invitation_sent'), 1::bigint, 'the invitation is in the tenant trail');
select lives_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', ' Mixed@Example.TEST ', 'deal_member', repeat('2', 64))$$,
  'an email with stray spaces and capitals is accepted');
select is((select count(*) from public.invitations where email = 'mixed@example.test'), 1::bigint, 'and stored trimmed and lower-case');
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'not-an-email', 'deal_member', repeat('3', 64))$$, '22023', 'invalid email', 'a malformed email is refused');
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'a@example.test', 'deal_member', 'short')$$, '22023', 'invalid token hash', 'only a sha256 hex digest is accepted');
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'a@example.test', 'no_such_role', repeat('3', 64))$$, 'P0002', 'role not found', 'an unknown role is refused');
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'u3@example.test', 'deal_member', repeat('3', 64))$$, '22023', 'already a member', 'an active member cannot be invited again');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
insert into ids select 'adm', public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'x@example.test', 'deal_member', repeat('4', 64));
select ok((select id from ids where k = 'adm') is not null, 'an Admin can invite to an ordinary role');
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'y@example.test', 'admin', repeat('5', 64))$$, '42501', 'cannot grant a privileged role', 'but not to a privileged one');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'y@example.test', 'deal_member', repeat('5', 64))$$, '42501', 'permission denied', 'a member without member.manage cannot invite');
select is((select count(*) from public.invitations), 0::bigint, 'and cannot list invitations either');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select ok((select count(*) from public.invitations) >= 3, 'the Owner sees the invitations of their tenant');
select lives_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'new@example.test', 'deal_lead', repeat('6', 64))$$, 'inviting the same email again works');
select ok((select revoked_at is not null from public.invitations where id = (select id from ids where k = 'inv')), 'and invalidates the earlier invitation');

-- Revoking ----------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select throws_ok(format($$select public.revoke_invitation(%L)$$, (select id from ids where k = 'adm')), '42501', 'permission denied', 'a member without member.manage cannot revoke');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select lives_ok(format($$select public.revoke_invitation(%L)$$, (select id from ids where k = 'adm')), 'the Owner can revoke a pending invitation');
select throws_ok(format($$select public.revoke_invitation(%L)$$, (select id from ids where k = 'adm')), 'P0002', 'invitation not found', 'and only a pending one');
reset role;

-- The landing page and acceptance (api_service) ---------------------------------------------------------------------------------------
set local role api_service;
select is((select tenant_name || '|' || inviter_email || '|' || role_name || '|' || email from public.invitation_preview(repeat('6', 64))),
  'Acme Capital|u1@example.test|Deal Lead|new@example.test', 'the preview shows organisation, inviter, role and the invited email');
select throws_ok($$select * from public.invitation_preview(repeat('7', 64))$$, 'DP401', 'invalid token', 'an unknown token gives the generic answer');
select throws_ok($$select * from public.invitation_preview(repeat('4', 64))$$, 'DP401', 'invalid token', 'so does a revoked one');
select throws_ok($$select * from public.invitation_preview(repeat('1', 64))$$, 'DP401', 'invalid token', 'and one replaced by a newer invitation');
reset role;
update public.invitations set expires_at = now() - interval '1 second' where token_hash = repeat('2', 64);
set local role api_service;
select throws_ok($$select * from public.invitation_preview(repeat('2', 64))$$, 'DP401', 'invalid token', 'and an expired one');
select throws_ok($$select public.invitation_accept(repeat('6', 64), 'aaaaaaaa-0000-4000-8000-000000000005')$$, 'DP401', 'invalid token',
  'a user whose email differs from the invited one cannot accept (email-bound)');
select is(public.invitation_accept(repeat('6', 64), 'aaaaaaaa-0000-4000-8000-000000000004'), 'bbbbbbbb-0000-4000-8000-00000000000a'::uuid,
  'the invited user accepts and gets the tenant');
select throws_ok($$select public.invitation_accept(repeat('6', 64), 'aaaaaaaa-0000-4000-8000-000000000004')$$, 'DP401', 'invalid token', 'a token works once');
reset role;
select is((select count(*) from public.memberships m join public.membership_roles mr on mr.membership_id = m.id join public.roles r on r.id = mr.role_id
            where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000004' and m.deactivated_at is null and r.key = 'deal_lead'),
  1::bigint, 'acceptance created the membership with the invited role');
select is((select flow || '/' || current_step from public.onboarding_progress where user_id = 'aaaaaaaa-0000-4000-8000-000000000004'),
  'invitee/profile', 'and started the short invitee flow');
select is((select actor_id from public.tenant_events where kind = 'invitation_accepted'), 'aaaaaaaa-0000-4000-8000-000000000004'::uuid,
  'the trail names the invitee as the actor');

-- An invited address nobody has verified is verified by the invitation itself (the link proves possession).
insert into public.invitations (tenant_id, email, role_key, token_hash, invited_by, expires_at)
values ('bbbbbbbb-0000-4000-8000-00000000000a', 'late@example.test', 'deal_member', repeat('8', 64),
        'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '7 days');
set local role api_service;
select public.invitation_accept(repeat('8', 64), 'aaaaaaaa-0000-4000-8000-000000000006');
reset role;
select ok((select email_confirmed_at is not null from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000006'), 'accepting verifies the invited email');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
select public.profile_upsert('New Member', null);
select is(public.onboarding_advance('profile'), 'done', 'the invitee flow is just the profile step');
reset role;

-- Exposure --------------------------------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.invite_member(uuid,text,text,text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.revoke_invitation(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.invite_member(uuid,text,text,text)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.invitation_accept(text,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.invitation_preview(text)', 'EXECUTE'),
  'members invite and revoke; only the API service previews and accepts');
select ok(has_function_privilege('api_service', 'public.invitation_accept(text,uuid)', 'EXECUTE')
      and has_function_privilege('api_service', 'public.invitation_preview(text)', 'EXECUTE')
      and not has_function_privilege('api_service', 'public.invite_member(uuid,text,text,text)', 'EXECUTE'),
  'api_service can accept and preview, and cannot invite');

-- Cap ----------------------------------------------------------------------------------------------------------------------------------------
insert into public.invitations (tenant_id, email, role_key, token_hash, invited_by, expires_at)
select 'bbbbbbbb-0000-4000-8000-00000000000a', 'bulk' || n || '@example.test', 'deal_member', md5(n::text) || md5((n + 1000)::text),
       'aaaaaaaa-0000-4000-8000-000000000001', now() + interval '7 days'
from generate_series(1, 60) as n;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select throws_ok($$select public.invite_member('bbbbbbbb-0000-4000-8000-00000000000a', 'one-too-many@example.test', 'deal_member', repeat('9', 64))$$,
  'DP422', 'invitation limit reached', 'pending invitations are capped per tenant');
reset role;

select * from finish();
rollback;
