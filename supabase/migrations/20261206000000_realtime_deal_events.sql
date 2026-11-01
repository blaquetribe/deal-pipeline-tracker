-- Publish immutable activity inserts so every consequential deal change can refresh active views.
-- The API relays only an invalidation signal; event bodies and deal contents remain private.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deal_events'
    ) then
    alter publication supabase_realtime add table public.deal_events;
  end if;
end
$$;
