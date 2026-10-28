-- Feature 02: the persisted SQL step machine matches the shared TS/SQL fixture.
begin;
select plan(1);

create temp table onboarding_fixture as
  select pg_read_file('/fixtures/onboarding-steps.json')::jsonb as doc;

select set_eq(
  $$select flow, position, step, required from public.onboarding_steps$$,
  $$select flows.flow, (steps.value ->> 'position')::integer, steps.value ->> 'step',
           (steps.value ->> 'required')::boolean
      from onboarding_fixture f
      cross join jsonb_each(f.doc -> 'flows') as flows(flow, items)
      cross join jsonb_array_elements(flows.items) as steps(value)$$,
  'the SQL owner and invitee steps match the shared fixture'
);

select * from finish();
rollback;
