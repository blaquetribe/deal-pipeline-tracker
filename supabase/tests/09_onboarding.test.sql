-- Feature 02, slice B: tenant settings, the server-driven onboarding state machine and
-- create_organisation (verified, once per user, only at its step). Written before the migration.
begin;
select plan(36);

-- Structure -----------------------------------------------------------------------------------------------------
select has_table('public', 'onboarding_steps', 'the steps of each flow are data');
select has_table('public', 'onboarding_progress', 'progress is stored per user (resumable)');
select is(
  (select count(*) from unnest(array['onboarding_steps', 'onboarding_progress']) as t(name)
    where not (select relrowsecurity and relforcerowsecurity from pg_class where oid = to_regclass('public.' || t.name))
       or has_table_privilege('authenticated', to_regclass('public.' || t.name), 'INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('anon', to_regclass('public.' || t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  0::bigint, 'RLS forced, no direct writes for users, nothing for anon'
);
select is(
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tenants'
     and column_name in ('timezone', 'default_currency', 'closing_soon_days')),
  3::bigint, 'tenants carry timezone, default currency and the closing-soon window'
);
select ok(not has_function_privilege('authenticated', 'public.create_tenant(text)', 'EXECUTE'),
  'the raw create_tenant is no longer callable by users: create_organisation is the only way in');
select ok(has_function_privilege('authenticated', 'public.create_organisation(text,text,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.create_organisation(text,text,text)', 'EXECUTE'),
  'create_organisation is for authenticated only');

-- Fixtures: u1 signs up and verifies; u2 never verified; u3 verified with no onboarding record ------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@example.test', case when n = 3 then now() end
from generate_series(1, 4) as n;
create temp table ids (k text primary key, id uuid);
grant all on ids to public;
grant usage on schema extensions to api_service;  -- pgTAP only; production does not grant this

-- Verification starts the owner flow ------------------------------------------------------------------------------------------------
set local role api_service;
select public.token_issue('verify_email', 'aaaaaaaa-0000-4000-8000-000000000001', repeat('1', 64));
select public.token_consume('verify_email', repeat('1', 64));
reset role;
select is((select flow || '/' || current_step from public.onboarding_progress where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'owner/profile', 'verifying the email creates the owner flow at the profile step');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select is((select current_step from public.onboarding_state()), 'profile', 'onboarding_state reports the current step (resume)');

-- Steps cannot be skipped or done out of order ---------------------------------------------------------------------------------------
select throws_ok($$select public.create_organisation('Acme')$$, 'DP422', 'not at this step', 'an organisation cannot be created before the profile step is done');
select throws_ok($$select public.onboarding_advance('profile')$$, 'DP422', 'profile required', 'the profile step needs a profile');
select throws_ok($$select public.onboarding_advance('organisation')$$, 'DP422', 'not at this step', 'a later step cannot be completed early');
select throws_ok($$select public.onboarding_skip('profile')$$, 'DP422', 'step is required', 'a required step cannot be skipped');
select lives_ok($$select public.profile_upsert('Ada Lovelace', 'Partner')$$, 'the profile is written');
select is(public.onboarding_advance('profile'), 'organisation', 'and the flow moves to the organisation step');
select throws_ok($$select public.onboarding_skip('organisation')$$, 'DP422', 'step is required', 'the organisation step cannot be skipped');
select throws_ok($$select public.onboarding_advance('organisation')$$, 'DP422', 'use create_organisation', 'it is completed only by creating the organisation');

-- create_organisation ----------------------------------------------------------------------------------------------------------------------
select throws_ok($$select public.create_organisation('Acme', 'Mars/Phobos')$$, '22023', 'unknown time zone', 'an unknown time zone is refused');
select throws_ok($$select public.create_organisation('Acme', 'Africa/Johannesburg', 'zar')$$, '23514', null, 'a currency must be an ISO code in capitals');
select throws_ok($$select public.create_organisation('')$$, '23514', null, 'an organisation needs a name');
insert into ids select 'T', public.create_organisation('Acme Capital', 'Africa/Johannesburg', 'ZAR');
select ok((select id from ids where k = 'T') is not null, 'a verified user at the organisation step creates their organisation');
select is((select timezone || '/' || default_currency || '/' || closing_soon_days from public.tenants where id = (select id from ids where k = 'T')),
  'Africa/Johannesburg/ZAR/60', 'with its settings and the ADR 0011 60-day closing-soon default');
select ok(app.has_permission((select id from ids where k = 'T'), 'role.manage'), 'and the creator is its Owner');
select is((select current_step from public.onboarding_state()), 'defaults', 'the flow moves on to the optional steps');
select throws_ok($$select public.create_organisation('Second Fund')$$, 'DP422', 'not at this step', 'a second organisation is refused');
reset role;
update public.onboarding_progress set current_step = 'organisation' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_organisation('Second Fund')$$, 'DP422', 'organisation already created',
  'even if the progress record were rewound, one user cannot create two (the tenant trail remembers)');
reset role;
update public.onboarding_progress set current_step = 'defaults' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Users who should not get in ------------------------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select throws_ok($$select public.create_organisation('Nope')$$, '42501', 'email not verified', 'an unverified user cannot create an organisation');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select throws_ok($$select public.create_organisation('Nope')$$, 'DP422', 'not at this step', 'a verified user with no onboarding record cannot either');
select is((select count(*) from public.onboarding_state()), 0::bigint, 'and has no state to show');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);

-- Optional steps ---------------------------------------------------------------------------------------------------------------------------------
select lives_ok(format($$select public.update_tenant_settings(%L, 'Africa/Johannesburg', 'USD', 45)$$, (select id from ids where k = 'T')),
  'the Owner can set the organisation defaults');
select is((select default_currency || '/' || closing_soon_days from public.tenants where id = (select id from ids where k = 'T')), 'USD/45', 'and they are stored');
select throws_ok(format($$select public.update_tenant_settings(%L, 'Africa/Johannesburg', 'USD', 0)$$, (select id from ids where k = 'T')),
  '23514', null, 'a closing-soon window must be a positive number of days');
select is(public.onboarding_advance('defaults'), 'invite', 'completing the defaults step moves to inviting');
select is(public.onboarding_skip('invite'), 'done', 'the invite step can be skipped');
select is((select completed from public.onboarding_state()), true, 'and the flow is complete');
select throws_ok($$select public.onboarding_skip('done')$$, 'DP422', 'not at this step', 'nothing more to do once complete');

reset role;
insert into public.memberships (tenant_id, user_id) values ((select id from ids where k = 'T'), 'aaaaaaaa-0000-4000-8000-000000000004');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = 'deal_member'
where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
select throws_ok(format($$select public.update_tenant_settings(%L, 'Africa/Johannesburg', 'USD', 10)$$, (select id from ids where k = 'T')),
  '42501', 'permission denied', 'a member without role.manage cannot change the defaults');
reset role;

select * from finish();
rollback;
