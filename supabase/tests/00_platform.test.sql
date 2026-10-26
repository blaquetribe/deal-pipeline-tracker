-- Platform baseline: what every later migration and test relies on.
begin;
select plan(11);

select has_extension('pgcrypto', 'pgcrypto is installed');
select is(
  encode(extensions.digest('abc', 'sha256'), 'hex'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'sha256 digest is correct (hash chain primitive)'
);

select has_table('supabase_migrations', 'schema_migrations', 'migration bookkeeping table exists');
select ok(
  exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000000'),
  'the baseline migration is recorded'
);
select is(
  (select count(*) from supabase_migrations.migration_checksums),
  (select count(*) from supabase_migrations.schema_migrations),
  'every applied migration has a checksum'
);

select has_role('anon', 'role anon exists');
select has_role('authenticated', 'role authenticated exists');
select has_role('service_role', 'role service_role exists');
select has_role('authenticator', 'role authenticator exists');
select has_schema('_realtime', 'realtime schema exists');
select ok(
  exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
  'the supabase_realtime publication exists'
);

select * from finish();
rollback;
