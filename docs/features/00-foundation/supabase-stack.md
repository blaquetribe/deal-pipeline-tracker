# Supabase stack: what it costs and what we need

Measured 2026-10-26 while starting feature 00 part 2b. Decision: [ADR 0013](../../decisions/0013-supabase-stack-for-compose.md).

## Method and caveats (read before quoting numbers)
- Source: Supabase's official self-hosting files (`supabase/supabase`, `docker/`, commit `f4d6d90`, 2026-10-26), run from a scratch copy outside the repo with the demo placeholders from its `.env.example` (used only for this throwaway measurement, never for our own stack).
- Engine: **Podman 6.1.1** VM (Apple virtualization, 3,887 MB RAM, 7 CPUs). Not Docker Desktop, whose own VM overhead will differ.
- **Idle, no load, single run each.** `docker stats` reports cgroup usage (may include page cache); the VM's `free -m` "used" figure is the total picture. The VM already used 781 MB with nothing running, and 948 MB right after stopping the full stack (caches), so increments below are ranges.

## What the official stack contains (11 services)
`db` (Postgres), `auth` (GoTrue), `rest` (PostgREST), `realtime`, `api-gw` (**Envoy**, which replaced Kong), `studio`, `storage`, `imgproxy`, `meta`, `functions` (edge runtime), `supavisor` (pooler). Logs and analytics are a separate optional compose file now. **No memory limits are set**, and **no mail service is included** (its default SMTP host `supabase-mail` does not exist in this compose). The gateway waits on Studio being healthy, and the file publishes ports 8000 (gateway) and 5432/6543 (pooler) on the host.

## Measurements
| | Full (11 services) | Trimmed (db, auth, rest, realtime, gateway) | Trimmed + our 3 containers (8 total) |
|---|---|---|---|
| Sum of container memory | **1,244 MiB** | **446 MiB** | **654 MiB** |
| VM memory used (of 3,887 MB) | peak 2,238, settled about 2,115 | 1,242 to 1,513 | 1,554 |
| VM memory available | about 1,770 | about 2,400 | 2,333 |
| Image download size | about 7.3 GB | **about 2.5 GB** | about 3 GB |
| Time to healthy (images present) | about 1 min | about 1 min (auth answered 8 s after the database was healthy) | |

Per container, full stack (MiB): studio 237, realtime 212, pooler 205, meta 125, rest 115, db 110, storage 103, imgproxy 42, envoy 37, functions 35, auth 23. Trimmed: realtime 220, db 98, rest 77, envoy 40, auth 11. Ours: api 125, gateway 58, web 46.

**Reading:** dropping six services we do not use (Studio, pooler, meta, storage, imgproxy, functions) cuts container memory by about 64% and the download by about two thirds. The whole system a reviewer would run (Supabase trimmed plus our gateway, web and API) is about 650 MiB of containers, comfortably inside a 4 GB VM. **Below about 2 GB of VM memory is unmeasured**; say "tested in a 4 GB VM" in the README, not "runs anywhere".

## What was verified on the trimmed stack (not just started)
- Auth answers through the gateway (GoTrue v2.197.0); a request with no API key is refused (401).
- **REST works:** a table created in the database was read back through the gateway as JSON with the anon key (200). The root OpenAPI endpoint is denied to the anon key (403) and open to the service-role key (200): the new Envoy gateway applies role-based rules, which is a behaviour change from Kong.
- **Our onboarding assumption is real (ADR 0002, item 13):** a user created through the admin API with `email_confirm=false` **cannot log in** (`email_not_confirmed`, HTTP 400); after the flag is set to true, login returns 200 with an access token.
- **Realtime works through the gateway:** a WebSocket opened, the channel join was accepted, and a database insert arrived as a live `INSERT` event. Caveat: this used the demo anon key, so it proves the mechanism, not yet RLS-filtered delivery for a signed-in user's JWT (feature 05 spike).
- **Database image:** PostgreSQL 17.6; `pgcrypto` is installed and `digest(..., 'sha256')` returned the correct value (so the hash-chained ledger is feasible); **`pgTAP` 1.3.3 is available** (database tests); **`pg_cron` 1.6.4 is available and in `shared_preload_libraries`** (the closing-soon scheduler can be a database job; enable it in a migration); `pg_trgm` is available (search). `pgaudit`, `pg_net` and `supabase_vault` are preloaded.
- The `!reset` compose override (removing the gateway's dependency on Studio) works with Compose 5.5.1; it needs Docker Compose 2.24 or newer.

## Not verified (to do in part 2b and later)
- Which of the upstream database init scripts (`roles.sql`, `jwt.sql`, `realtime.sql`, `_supabase.sql`, `webhooks.sql`, ...) the trimmed stack truly needs, and the minimal trimmed Envoy configuration (it currently routes to services we omit).
- RLS-filtered Realtime delivery for a real user JWT held by the API (feature 05).
- Behaviour under Docker Desktop and on the CI runner; memory under load; behaviour on amd64 (measured on arm64).
- Mail: no service in the compose; we add Mailpit.

## Cleanup done
Both stacks stopped, 0 containers running, host ports free. The six images only the full stack needed were removed (about 4.7 GB); the five needed images were kept. The scratch copy lives outside the repo.
