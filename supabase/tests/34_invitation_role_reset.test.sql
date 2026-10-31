begin;
select plan(5);
insert into auth.users (id, instance_id, aud, role, email) values
  ('36363636-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@reactivate.example.test'),
  ('36363636-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'backup@reactivate.example.test'),
  ('36363636-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'returning@reactivate.example.test');
insert into public.tenants (id, name) values ('37373737-0000-4000-8000-00000000000a', 'Reactivation Roles');
select app.seed_system_roles('37373737-0000-4000-8000-00000000000a');
insert into public.memberships (tenant_id, user_id) values
  ('37373737-0000-4000-8000-00000000000a', '36363636-0000-4000-8000-000000000001'),
  ('37373737-0000-4000-8000-00000000000a', '36363636-0000-4000-8000-000000000002'),
  ('37373737-0000-4000-8000-00000000000a', '36363636-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id
where (m.user_id in ('36363636-0000-4000-8000-000000000001', '36363636-0000-4000-8000-000000000002') and r.key = 'owner')
   or (m.user_id = '36363636-0000-4000-8000-000000000003' and r.key = 'admin');
update public.memberships set deactivated_at = now() where user_id = '36363636-0000-4000-8000-000000000003';
insert into public.invitations (tenant_id, email, role_key, token_hash, invited_by, expires_at)
values ('37373737-0000-4000-8000-00000000000a', 'returning@reactivate.example.test', 'deal_member', repeat('a', 64),
        '36363636-0000-4000-8000-000000000001', now() + interval '7 days');
grant usage on schema extensions to api_service; -- pgTAP only; production does not grant this.
set local role api_service;
select is(public.invitation_accept(repeat('a', 64), '36363636-0000-4000-8000-000000000003')::text,
  '37373737-0000-4000-8000-00000000000a', 'returning member accepts the replacement invitation');
reset role;
select is((select m.deactivated_at from public.memberships m where m.user_id = '36363636-0000-4000-8000-000000000003'),
  null, 'acceptance reactivates the previous membership');
select is((select count(*) from public.membership_roles mr join public.memberships m on m.id = mr.membership_id
  where m.user_id = '36363636-0000-4000-8000-000000000003'), 1::bigint,
  'old role grants are removed during reactivation');
select is((select r.key from public.membership_roles mr join public.memberships m on m.id = mr.membership_id
  join public.roles r on r.id = mr.role_id where m.user_id = '36363636-0000-4000-8000-000000000003'),
  'deal_member', 'only the newly invited role is restored');
select is((select detail from public.tenant_events where kind = 'invitation_accepted'),
  'deal_member', 'the tenant audit trail records the replacement role');
select * from finish();
rollback;
