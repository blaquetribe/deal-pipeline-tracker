-- Deal audit attribution, table filters/sorting and requester-selected approval slots.
begin;
select plan(17);

select has_function('public','list_deals_table',array['uuid','text','text','text','text','text','text','text','integer','integer'],
  'sortable and filterable deal table is a database query');
select has_function('public','eligible_deal_approvers',array['uuid'],'requesters can inspect eligible IC approvers');
select has_function('public','request_approval_to',array['uuid','integer','uuid[]'],'requesters can select approver slots');
select ok(has_function_privilege('authenticated','public.request_approval_to(uuid,integer,uuid[])','EXECUTE')
  and not has_function_privilege('anon','public.request_approval_to(uuid,integer,uuid[])','EXECUTE'),
  'approver routing is authenticated only');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.tenant_change_signals'::regclass),
  'realtime tenant signals enforce RLS');

insert into auth.users (id,instance_id,aud,role,email) values
  ('35353535-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-owner@example.test'),
  ('35353535-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-lead@example.test'),
  ('35353535-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-ic@example.test'),
  ('35353535-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-outsider@example.test');
insert into public.tenants(id,name) values
  ('36363636-0000-4000-8000-00000000000a','Audit tenant A'),
  ('36363636-0000-4000-8000-00000000000b','Audit tenant B');
select app.seed_system_roles(id) from public.tenants where id in (
  '36363636-0000-4000-8000-00000000000a','36363636-0000-4000-8000-00000000000b');
insert into public.memberships(tenant_id,user_id) values
  ('36363636-0000-4000-8000-00000000000a','35353535-0000-4000-8000-000000000001'),
  ('36363636-0000-4000-8000-00000000000a','35353535-0000-4000-8000-000000000002'),
  ('36363636-0000-4000-8000-00000000000a','35353535-0000-4000-8000-000000000003'),
  ('36363636-0000-4000-8000-00000000000b','35353535-0000-4000-8000-000000000004');
insert into public.membership_roles(tenant_id,membership_id,role_id)
select m.tenant_id,m.id,r.id from public.memberships m join public.roles r on r.tenant_id=m.tenant_id
where (m.user_id='35353535-0000-4000-8000-000000000001' and r.key='owner')
   or (m.user_id='35353535-0000-4000-8000-000000000002' and r.key='deal_lead')
   or (m.user_id='35353535-0000-4000-8000-000000000003' and r.key='ic_member');
create temporary table audit_route_ids(deal uuid,request uuid);
grant all on audit_route_ids to public;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"35353535-0000-4000-8000-000000000001"}',true);
select public.configure_approval_policy('36363636-0000-4000-8000-00000000000a',1);
select set_config('request.jwt.claims','{"sub":"35353535-0000-4000-8000-000000000002"}',true);
insert into audit_route_ids(deal,request) values(public.create_deal(
  '36363636-0000-4000-8000-00000000000a','Audit routing deal','Energy',200000,'ZAR','2027-06-30'),null);
select is(public.deal_detail((select deal from audit_route_ids)) #>> '{created_by,userId}',
  '35353535-0000-4000-8000-000000000002', 'deal creator is server-attributed');
select is(public.deal_detail((select deal from audit_route_ids)) #>> '{updated_by,userId}',
  '35353535-0000-4000-8000-000000000002', 'last updater is server-attributed');
select is(public.deal_detail((select deal from audit_route_ids))->>'rejected','false',
  'a deal without a rejected request has no rejection state');
select is((public.list_deals_table('36363636-0000-4000-8000-00000000000a',null,'routing','Energy',null,'none','name','asc',20,0)->>'total'),
  '1','table search, sector and approval filters compose');
select throws_ok($$select public.list_deals_table('36363636-0000-4000-8000-00000000000a',null,null,null,null,null,'created_at','desc',20,0)$$,
  '22023','invalid sort','table sort fields are allow-listed');
select ok((public.eligible_deal_approvers((select deal from audit_route_ids))->'approvers') @> '[{"userId":"35353535-0000-4000-8000-000000000003"}]'::jsonb,
  'requester sees the eligible approver identity');
reset role;
update public.deals set stage='ic_review',version=2 where id=(select deal from audit_route_ids);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"35353535-0000-4000-8000-000000000002"}',true);
update audit_route_ids set request=public.request_approval_to(
  (select deal from audit_route_ids),2,array[(
    select (candidate->>'membershipId')::uuid
    from jsonb_array_elements(public.eligible_deal_approvers((select deal from audit_route_ids))->'approvers') candidate
    where candidate->>'userId'='35353535-0000-4000-8000-000000000003'
  )]);
select is((select count(*)::text from public.approval_request_approvers where request_id=(select request from audit_route_ids)),'1',
  'only the requester-selected approver slot is snapshotted');
select is(public.deal_detail((select deal from audit_route_ids)) #>> '{approval,requestedBy,userId}',
  '35353535-0000-4000-8000-000000000002','approval request attribution is available in deal detail');
select is(public.deal_detail((select deal from audit_route_ids)) #>> '{approval,approvers,0,userId}',
  '35353535-0000-4000-8000-000000000003','selected approver identity is available in deal detail');
select is((select count(*)::text from public.tenant_change_signals where tenant_id='36363636-0000-4000-8000-00000000000a'),'1',
  'tenant changes coalesce into a single content-free realtime signal');
select set_config('request.jwt.claims','{"sub":"35353535-0000-4000-8000-000000000004"}',true);
select throws_ok($$select public.list_deals_table('36363636-0000-4000-8000-00000000000a',null,null,null,null,null,'name','asc',20,0)$$,
  '42501','permission denied','deal table cannot be read across tenants');
select throws_ok(format($$select public.eligible_deal_approvers(%L)$$,(select deal from audit_route_ids)),
  '42501','permission denied','other tenant users cannot inspect approvers');
reset role;

select * from finish();
rollback;
