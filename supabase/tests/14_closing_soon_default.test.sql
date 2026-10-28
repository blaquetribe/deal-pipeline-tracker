-- ADR 0011 supersedes the original 30-day assumption. Future tenants default to 60 days.
begin;
select plan(1);

select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'tenants' and column_name = 'closing_soon_days'),
  '60',
  'new tenants use the accepted 60-day closing-soon default'
);

select * from finish();
rollback;
