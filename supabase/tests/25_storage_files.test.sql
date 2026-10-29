begin;
select plan(22);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.files'::regclass),
  'file metadata has forced row-level security'
);
select ok(
  has_table_privilege('authenticated', 'public.files', 'SELECT')
    and not has_table_privilege('authenticated', 'public.files', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('api_service', 'public.files', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role', 'public.files', 'INSERT,UPDATE,DELETE'),
  'file rows expose only authorized reads; writes remain behind narrow RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.file_create_pending(uuid,text,uuid,text,text,text,bigint)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.file_mark_ready(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.file_create_pending(uuid,text,uuid,text,text,text,bigint)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.file_mark_ready(uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.file_mark_ready(uuid)', 'EXECUTE'),
  'only signed-in users may invoke the upload state transitions'
);
select ok(
  (select attnotnull from pg_attribute where attrelid = 'public.files'::regclass and attname = 'tenant_id'),
  'every file has a tenant id'
);
select ok(
  (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'files'),
  'file table has one explicit read policy and no write policies'
);
select ok(
  not has_table_privilege('authenticated', 'public.files', 'TRUNCATE')
    and not has_table_privilege('api_service', 'public.files', 'TRUNCATE'),
  'application roles cannot truncate file metadata'
);
select ok(
  has_function_privilege('api_service', 'public.file_cleanup_stale_pending()', 'EXECUTE')
    and has_function_privilege('api_service', 'public.file_list_object_keys()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.file_cleanup_stale_pending()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.file_list_object_keys()', 'EXECUTE')
    and not has_function_privilege('public', 'public.file_cleanup_stale_pending()', 'EXECUTE'),
  'only the internal API service can run orphan cleanup and list stored object keys'
);
select ok(
  has_function_privilege('authenticated', 'public.file_list_for_deal(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.file_list_for_deal(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.file_list_for_deal(uuid)', 'EXECUTE'),
  'deal attachment listing is signed-in and tenant-authorized'
);

insert into auth.users (id, instance_id, aud, role, email) values
  ('30303030-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'file-owner@example.test'),
  ('30303030-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'file-peer@example.test'),
  ('30303030-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'file-other@example.test');
insert into public.tenants (id, name) values
  ('31313131-0000-4000-8000-000000000001', 'File tenant A'),
  ('31313131-0000-4000-8000-000000000002', 'File tenant B');
select app.seed_system_roles(id) from public.tenants
  where id in ('31313131-0000-4000-8000-000000000001', '31313131-0000-4000-8000-000000000002');
insert into public.memberships (tenant_id, user_id) values
  ('31313131-0000-4000-8000-000000000001', '30303030-0000-4000-8000-000000000001'),
  ('31313131-0000-4000-8000-000000000001', '30303030-0000-4000-8000-000000000002'),
  ('31313131-0000-4000-8000-000000000002', '30303030-0000-4000-8000-000000000003');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id
where (m.user_id = '30303030-0000-4000-8000-000000000001' and r.key = 'owner')
   or (m.user_id = '30303030-0000-4000-8000-000000000002' and r.key = 'observer_compliance')
   or (m.user_id = '30303030-0000-4000-8000-000000000003' and r.key = 'owner');
create temporary table file_test_ids (deal_id uuid);
grant all on file_test_ids to public;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000001"}', true);
insert into file_test_ids values (public.create_deal('31313131-0000-4000-8000-000000000001', 'File attachment test'));
reset role;
insert into public.files (id, tenant_id, owner_id, deal_id, kind, object_key, content_sha256, content_type, byte_size, state) values
  ('32323232-0000-4000-8000-000000000001', '31313131-0000-4000-8000-000000000001', '30303030-0000-4000-8000-000000000001', null, 'avatar',
   'Dev/users/30303030-0000-4000-8000-000000000001/avatar/42323232-0000-4000-8000-000000000001-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   repeat('a', 64), 'image/webp', 200, 'ready'),
  ('32323232-0000-4000-8000-000000000002', '31313131-0000-4000-8000-000000000001', '30303030-0000-4000-8000-000000000001', (select deal_id from file_test_ids), 'attachment',
   'Dev/tenants/31313131-0000-4000-8000-000000000001/attachment/42323232-0000-4000-8000-000000000002-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   repeat('b', 64), 'application/pdf', 300, 'ready');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000002"}', true);
select is((select count(*)::integer from public.files where kind = 'avatar'), 1, 'a same-tenant peer can read the owner avatar');
select is(public.file_avatar_id('30303030-0000-4000-8000-000000000001'), '32323232-0000-4000-8000-000000000001'::uuid,
  'avatar lookup is available to a peer sharing an active tenant');
select is((select count(*)::integer from public.files where kind = 'attachment'), 1, 'a deal viewer can read same-tenant attachments');
select ok(public.file_metadata('32323232-0000-4000-8000-000000000002') is not null, 'authorized metadata lookup returns the attachment row');
select is(jsonb_array_length(public.file_list_for_deal((select deal_id from file_test_ids))), 1,
  'deal attachment list contains only the authorized tenant file');
select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000003"}', true);
select is((select count(*)::integer from public.files where kind = 'attachment'), 0, 'another tenant cannot read the attachment row');
select ok(public.file_metadata('32323232-0000-4000-8000-000000000002') is null, 'cross-tenant download metadata is indistinguishable from missing');
select is(public.file_list_for_deal((select deal_id from file_test_ids)), '[]'::jsonb,
  'another tenant receives an empty attachment list');
select ok(public.file_avatar_id('30303030-0000-4000-8000-000000000001') is null, 'an unrelated tenant cannot resolve the avatar');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30303030-0000-4000-8000-000000000001"}', true);
select throws_ok($$select public.file_create_pending(
  '31313131-0000-4000-8000-000000000001', 'avatar', null,
  'Dev/users/30303030-0000-4000-8000-000000000002/avatar/42323232-0000-4000-8000-000000000003-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  repeat('a', 64), 'image/webp', 200)$$,
  '22023', 'invalid object key', 'upload RPC rejects an object key outside the caller’s user namespace');
select public.file_create_pending(
  '31313131-0000-4000-8000-000000000001', 'avatar', null,
  'Dev/users/30303030-0000-4000-8000-000000000001/avatar/42323232-0000-4000-8000-000000000004-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  repeat('c', 64), 'image/webp', 200);
reset role;
update public.files set created_at = now() - interval '2 days'
  where object_key = 'Dev/users/30303030-0000-4000-8000-000000000001/avatar/42323232-0000-4000-8000-000000000004-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
create temporary table cleanup_result (keys text[]);
grant all on cleanup_result to public;
set local role api_service;
insert into cleanup_result select public.file_cleanup_stale_pending();
reset role;
select ok((select keys @> array[
  'Dev/users/30303030-0000-4000-8000-000000000001/avatar/42323232-0000-4000-8000-000000000004-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
]::text[] from cleanup_result), 'cleanup returns the key of a stale pending row for object deletion');
select is((select count(*)::integer from public.files where state = 'pending'), 0,
  'cleanup removes stale pending metadata');
select is((select count(*)::integer from public.files where state = 'ready'), 2,
  'cleanup leaves ready file rows untouched');
select is(array_length(public.file_list_object_keys(), 1), 2,
  'cleanup worker lists stored keys without receiving table access');
reset role;

select * from finish();
rollback;
