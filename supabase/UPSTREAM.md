# Vendored from Supabase (Apache-2.0)

Source: https://github.com/supabase/supabase, directory `docker/volumes`, commit `f4d6d9052788b70c7c712e552fe98b1af8649a73`.
Licence: Apache License 2.0 (the upstream `LICENSE`). Regenerate with
`python3 -I scripts/vendor-supabase.py <checkout>` (`make vendor-supabase UPSTREAM=<checkout>`);
the script asserts the shape of every edit and fails if upstream changed it.

| File | Upstream | Change |
|---|---|---|
| `db/init/jwt.sql`, `realtime.sql` | `volumes/db/*.sql` | verbatim |
| `db/init/roles.sql` | `volumes/db/roles.sql` | the `ALTER USER` lines for `pgbouncer`, `supabase_functions_admin` and `supabase_storage_admin` removed: the image runs init scripts with `ON_ERROR_STOP`, and `supabase_functions_admin` is created by an omitted script, so leaving the line in silently aborts the rest of database initialisation |
| (omitted scripts) | `volumes/db/*.sql` | Omitted: `webhooks.sql` (functions and pg_net), `_supabase.sql`, `logs.sql` (analytics), `pooler.sql` (Supavisor) |
| `gateway/envoy.yaml` | `volumes/api/envoy/envoy.yaml` | one line: the generated listener file is read from `/tmp/envoy/lds.yaml` so the container can have a read-only filesystem |
| `gateway/cds.yaml` | `volumes/api/envoy/cds.yaml` | clusters trimmed to `auth`, `rest`, `realtime` |
| `gateway/lds.template.yaml` | `volumes/api/envoy/lds.template.yaml` | routes to `functions`, `storage`, `meta` (`/pg/`) and `studio` (including `/mcp`) removed, and the Studio catch-all replaced by a 404 route. Everything else, including the API-key checks and the RBAC that denies Realtime tenant management and the REST root to the anon key, is untouched |
| `gateway/docker-entrypoint.sh` | `volumes/api/envoy/docker-entrypoint.sh` | rewritten: derives `ANON_KEY` and `SERVICE_ROLE_KEY` from `JWT_SECRET` with fixed claims (documented in the file), generates the listener config into `/tmp/envoy` |
| `gateway/healthcheck.sh` | (ours, not vendored) | readiness probe that exercises the real routes with the derived keys; not touched by this script |

Why trimmed and why the keys are derived: ADR 0013 and ADR 0014.
