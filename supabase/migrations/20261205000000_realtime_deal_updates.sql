-- Publish deal row changes so authenticated tenant members receive live refresh hints.
-- The API sends only an invalidation event; it never forwards row data over the socket.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deals'
    ) then
    alter publication supabase_realtime add table public.deals;
  end if;
end
$$;
