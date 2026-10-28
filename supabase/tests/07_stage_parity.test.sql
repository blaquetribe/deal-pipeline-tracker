-- Feature 01, slice 4 (E1): the database and the TypeScript mirror are held to one fixture,
-- packages/shared/fixtures/stage-machine.json (mounted at /fixtures). Written before the TS module.
begin;
select plan(17);

create temp table fx as select pg_read_file('/fixtures/stage-machine.json')::jsonb as doc;

select set_eq(
  $$select from_stage as a, to_stage as b from public.stage_transitions$$,
  $$select t ->> 0 as a, t ->> 1 as b from fx, jsonb_array_elements(doc -> 'transitions') as t$$,
  'the transitions table equals the fixture'
);
select set_eq(
  $$select stage as a, field as b from public.stage_requirements$$,
  $$select r.key as a, f as b from fx, jsonb_each(doc -> 'requirements') as r, jsonb_array_elements_text(r.value) as f$$,
  'the required fields equal the fixture'
);

-- Fixture: one tenant, a deal lead.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@example.test', now());
insert into public.tenants (id, name) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'Tenant A');
select app.seed_system_roles(id) from public.tenants where id in ('bbbbbbbb-0000-4000-8000-00000000000a');
insert into public.memberships (tenant_id, user_id) values ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.membership_roles (tenant_id, membership_id, role_id)
select m.tenant_id, m.id, r.id from public.memberships m join public.roles r on r.tenant_id = m.tenant_id and r.key = 'deal_lead';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}', true);

-- Runs one case through the real move_stage and reports the outcome in the fixture's vocabulary.
create function pg_temp.run_case(c jsonb) returns text language plpgsql as $$
declare
  v_deal uuid := gen_random_uuid();
  v_msg text;
begin
  insert into public.deals (id, tenant_id, name, stage, sector, amount, expected_close_date)
  values (v_deal, 'bbbbbbbb-0000-4000-8000-00000000000a', 'case', c ->> 'from',
          case when c -> 'present' ? 'sector' then 'Energy' end,
          case when c -> 'present' ? 'amount' then 1 end,
          case when c -> 'present' ? 'expected_close_date' then date '2027-01-01' end);
  perform public.move_stage(v_deal, c ->> 'to', 1);
  return 'ok';
exception when sqlstate 'DP422' then
  get stacked diagnostics v_msg = message_text;
  if v_msg = 'transition not allowed' then
    return 'transition_not_allowed';
  end if;
  return 'missing_fields:' || replace(substr(v_msg, length('missing required fields: ') + 1), ', ', ',');
end
$$;

select is(
  pg_temp.run_case(c),
  (c ->> 'expected') || case when c ->> 'expected' = 'missing_fields'
    then ':' || (select string_agg(m, ',' order by m) from jsonb_array_elements_text(c -> 'missing') as m) else '' end,
  'case: ' || (c ->> 'name')
)
from fx, jsonb_array_elements(doc -> 'cases') as c;

select * from finish();
rollback;
