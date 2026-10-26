-- Baseline: extensions the platform relies on.
--   pgcrypto: SHA-256 for the hash-chained audit ledger (ADR 0002).
-- The Supabase Postgres image already installs it; this records the dependency as a migration so a
-- fresh database always has it. pg_cron (closing-soon scheduler, ADR 0011) is enabled by the
-- migration that creates the job, because it needs a superuser role.
create extension if not exists pgcrypto with schema extensions;
