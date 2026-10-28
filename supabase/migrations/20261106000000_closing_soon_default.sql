-- ADR 0011 supersedes the earlier 30-day assumption. Preserve existing tenant choices;
-- only organisations created after this migration receive the accepted 60-day default.
alter table public.tenants alter column closing_soon_days set default 60;
