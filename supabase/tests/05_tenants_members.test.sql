-- Feature 01, slice 4: tenant creation, role grants with the escalation rules, deactivation, the
-- last-owner invariant, ownership transfer and the append-only tenant_events trail. Tests first.
begin;
select plan(38);

-- Fixtures: u1..u4 confirmed, u5 unconfirmed, u6 confirmed by phone only (auth.users.confirmed_at is
-- generated as LEAST(email_confirmed_at, phone_confirmed_at), so only email_confirmed_at proves the email) -----------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
select ('aaaaaaaa-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@example.test', case when n = 5 then null else now() end
from generate_series(1, 5) as n;
insert into auth.users (id, instance_id, aud, role, email, phone_confirmed_at)
values ('aaaaaaaa-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u6@example.test', now());
create temp table ids (k text primary key, id uuid);

-- create_tenant ---------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
insert into ids select 'T', public.create_tenant('Acme Capital');
select ok((select id from ids where k = 'T') is not null, 'a verified user can create a tenant');
select is((select count(*) from public.roles where tenant_id = (select id from ids where k = 'T') and is_system), 6::bigint,
  'the new tenant has the six system roles');
select ok(app.has_permission((select id from ids where k = 'T'), 'member.manage')
      and not app.has_permission((select id from ids where k = 'T'), 'approval.decide'),
  'the creator is the Owner: manages people, cannot decide approvals');
select is((select count(*) from public.tenant_events where kind = 'tenant_created' and tenant_id = (select id from ids where k = 'T')), 1::bigint,
  'creation is recorded in the tenant trail');
select throws_ok($$select public.create_tenant('')$$, '23514', null, 'a tenant needs a name');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000005"}', true);
select throws_ok($$select public.create_tenant('Unverified Ltd')$$, '42501', 'email not verified', 'an unverified user cannot create a tenant');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000006"}', true);
select throws_ok($$select public.create_tenant('Phone Only Ltd')$$, '42501', 'email not verified', 'a phone confirmation does not verify the email');
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.create_tenant('Nobody Ltd')$$, '42501', 'permission denied', 'nor can a request with no user');

-- Members: u2 becomes Admin, u3 a plain member; u4 owns another tenant ---------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}', true);
insert into ids select 'O', public.create_tenant('Other Fund');
insert into public.memberships (tenant_id, user_id) select (select id from ids where k = 'T'), u
  from unnest(array['aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003']::uuid[]) as u;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select lives_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000002', 'admin')$$, (select id from ids where k = 'T')),
  'the Owner can make someone an Admin');
select lives_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000003', 'deal_member')$$, (select id from ids where k = 'T')),
  'and give a member a deal role');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000001', 'admin')$$, (select id from ids where k = 'T')),
  '42501', 'cannot change your own roles', 'nobody changes their own roles');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000004', 'deal_member')$$, (select id from ids where k = 'T')),
  'P0002', 'member not found', 'a role goes only to an active member of the tenant');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000003', 'no_such_role')$$, (select id from ids where k = 'T')),
  'P0002', 'role not found', 'an unknown role is refused');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000002', 'ic_member')$$, (select id from ids where k = 'T')),
  '23514', 'separation of duties conflict', 'a grant that creates a duty conflict is refused (an Admin cannot also be an IC member)');

-- Admin: manages people but cannot hand out or take away privileged roles -------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select lives_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000003', 'observer_compliance')$$, (select id from ids where k = 'T')),
  'an Admin can grant an ordinary role');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000003', 'admin')$$, (select id from ids where k = 'T')),
  '42501', 'cannot grant a privileged role', 'an Admin cannot grant Admin');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000003', 'owner')$$, (select id from ids where k = 'T')),
  '42501', 'cannot grant a privileged role', 'an Admin cannot grant Owner');
select throws_ok(format($$select public.revoke_role(%L, 'aaaaaaaa-0000-4000-8000-000000000001', 'owner')$$, (select id from ids where k = 'T')),
  '42501', 'cannot grant a privileged role', 'an Admin cannot take Owner away from the Owner');
select throws_ok(format($$select public.deactivate_member(%L, 'aaaaaaaa-0000-4000-8000-000000000001')$$, (select id from ids where k = 'T')),
  '42501', 'cannot grant a privileged role', 'an Admin cannot deactivate the Owner');
select throws_ok(format($$select public.revoke_role(%L, 'aaaaaaaa-0000-4000-8000-000000000002', 'admin')$$, (select id from ids where k = 'T')),
  '42501', 'cannot change your own roles', 'an Admin cannot change their own roles either');
select throws_ok(format($$select public.deactivate_member(%L, 'aaaaaaaa-0000-4000-8000-000000000002')$$, (select id from ids where k = 'T')),
  '42501', 'cannot change your own roles', 'or deactivate themselves');
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000004', 'deal_member')$$, (select id from ids where k = 'O')),
  '42501', 'permission denied', 'an Admin of one tenant has no say in another');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select throws_ok(format($$select public.grant_role(%L, 'aaaaaaaa-0000-4000-8000-000000000002', 'deal_member')$$, (select id from ids where k = 'T')),
  '42501', 'permission denied', 'a member without member.manage cannot grant roles');

-- Revoke and deactivate work for ordinary roles ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select lives_ok(format($$select public.revoke_role(%L, 'aaaaaaaa-0000-4000-8000-000000000003', 'observer_compliance')$$, (select id from ids where k = 'T')),
  'an Admin can revoke an ordinary role');
select is((select count(*) from public.membership_roles mr join public.roles r on r.id = mr.role_id join public.memberships m on m.id = mr.membership_id
            where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000003' and r.key = 'observer_compliance'), 0::bigint, 'and it is gone');
select lives_ok(format($$select public.deactivate_member(%L, 'aaaaaaaa-0000-4000-8000-000000000003')$$, (select id from ids where k = 'T')),
  'an Admin can deactivate an ordinary member');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}', true);
select ok(not app.has_permission((select id from ids where k = 'T'), 'deal.view'), 'a deactivated member has no permission');

-- Last owner: an invariant that binds every role, including the superuser -------------------------------------------------
select throws_ok(format($$delete from public.membership_roles mr using public.roles r
    where r.id = mr.role_id and r.key = 'owner' and mr.tenant_id = %L$$, (select id from ids where k = 'T')),
  'DP422', 'cannot remove the last owner', 'the last Owner role assignment cannot be deleted');
select throws_ok(format($$update public.memberships set deactivated_at = now()
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and tenant_id = %L$$, (select id from ids where k = 'T')),
  'DP422', 'cannot remove the last owner', 'the last Owner cannot be deactivated');

-- Ownership transfer: explicit, and the tenant always has an owner -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select throws_ok(format($$select public.transfer_ownership(%L, 'aaaaaaaa-0000-4000-8000-000000000002')$$, (select id from ids where k = 'T')),
  '42501', 'only an owner can transfer ownership', 'only an Owner can transfer ownership');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select throws_ok(format($$select public.transfer_ownership(%L, 'aaaaaaaa-0000-4000-8000-000000000003')$$, (select id from ids where k = 'T')),
  'P0002', 'member not found', 'ownership goes only to an active member');
select lives_ok(format($$select public.transfer_ownership(%L, 'aaaaaaaa-0000-4000-8000-000000000002')$$, (select id from ids where k = 'T')),
  'the Owner can hand ownership to a member');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}', true);
select ok(app.has_permission((select id from ids where k = 'T'), 'role.manage'), 'the new Owner holds owner powers');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
select ok(not app.has_permission((select id from ids where k = 'T'), 'role.manage'), 'and the previous Owner no longer does');

-- The trail: append-only, readable by those who manage people or audit ---------------------------------------------------------------
select ok((select count(*) from public.tenant_events where tenant_id = (select id from ids where k = 'T')
            and kind in ('role_granted', 'role_revoked', 'member_deactivated', 'ownership_transferred')) >= 5,
  'grants, revocations, the deactivation and the transfer are all recorded');
select throws_ok($$update public.tenant_events set detail = 'x'$$, 'P0001', 'tenant_events is append-only', 'the tenant trail cannot be edited');
select throws_ok($$delete from public.tenant_events$$, 'P0001', 'tenant_events is append-only', 'or deleted');

-- Function exposure ----------------------------------------------------------------------------------------------------------------------
select is(
  (select count(*) from unnest(array[
    'public.create_tenant(text)', 'public.grant_role(uuid,uuid,text)', 'public.revoke_role(uuid,uuid,text)',
    'public.deactivate_member(uuid,uuid)', 'public.transfer_ownership(uuid,uuid)']) as f(sig)
   where has_function_privilege('authenticated', f.sig, 'EXECUTE') and not has_function_privilege('anon', f.sig, 'EXECUTE')),
  5::bigint, 'the five functions are for authenticated only'
);

select * from finish();
rollback;
