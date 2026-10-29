begin;
select plan(2);

select ok(
  has_function_privilege('api_service', 'public.seed_demo_data()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.seed_demo_data()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.seed_demo_data()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.seed_demo_data()', 'EXECUTE')
  and not has_function_privilege('public', 'public.seed_demo_data()', 'EXECUTE'),
  'only the internal API service can run the demo seed function'
);

select ok(
  not has_table_privilege('authenticated', 'public.tenants', 'INSERT')
  and not has_table_privilege('api_service', 'public.tenants', 'INSERT'),
  'demo seeding does not grant direct table writes'
);

select * from finish();
rollback;
