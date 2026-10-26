# ADR 0013: The Supabase stack in our compose

Status: accepted (design, based on measurements); integration is the next step of feature 00 part 2b. Evidence: [`docs/features/00-foundation/supabase-stack.md`](../features/00-foundation/supabase-stack.md).

## Decisions
1. **Run five services, not eleven:** `db` (supabase/postgres 17.6.1.136), `auth` (supabase/gotrue v2.197.0), `rest` (postgrest v14.18), `realtime` (supabase/realtime v2.143.3) and an **internal gateway** (Envoy v1.39.1, the official replacement for Kong). Omit Studio, pooler (Supavisor), meta, storage, imgproxy, functions and logging.
2. **Nothing is published to the host.** The services sit on an `internal` compose network that only the API, the migrate/seed jobs and Mailpit can reach; the public gateway remains our Caddy on a single port (ADR 0002). The official file's published ports (8000, 5432, 6543) are not used.
3. **Add Mailpit** for email (the official compose has no mail service); auth's SMTP settings point at it.
4. **Vendor, pin and credit the upstream files:** copy only the needed database init SQL and the trimmed gateway config from upstream commit `f4d6d90` into `supabase/`, with a note recording the source commit and licence. Image tags are pinned (digests added when integrated); Dependabot tracks them.
5. **Our own keys, never the demo ones:** JWT secret, anon and service-role keys and database password are generated per environment into the untracked `.env` (and CI secrets). `.env.example` holds placeholders only, enforced by `scripts/check-env-example.mjs`.
6. **No Studio** means no dashboard; day-to-day inspection uses `psql` and the SQL tests. An optional compose profile can add Studio later if wanted.

## Why
- **Measured:** the trimmed stack is 446 MiB against 1,244 MiB for all eleven services, and about 2.5 GB against 7.3 GB of images to download. With our three containers the whole system is about 654 MiB. A reviewer's first `docker compose up` is faster and more likely to fit their machine.
- **Less surface:** every omitted service is one less thing to patch, scan and secure, and the storage service is redundant with our own `ObjectStore` (ADR 0004).
- **Everything we rely on was exercised:** auth through the gateway, REST reads, the unconfirmed-user login rule, a realtime WebSocket change event, and the database extensions (`pgcrypto`, `pgTAP`, `pg_cron`).

## Consequences
- The trimmed gateway configuration and the minimal init-script set must be worked out and tested (open item).
- We carry a small fork of upstream config files; upgrades mean re-diffing against upstream. Mitigation: pin the source commit and keep the delta small.
- The gateway's role-based rules differ from Kong's (anon cannot read the REST root); our API uses the service-role key only in migration and seed jobs, never in request handlers (ADR 0002).

## Verified versus open
Verified: items above (see the evidence doc). Open: RLS-filtered Realtime for a real user's JWT (feature 05), behaviour under Docker Desktop and amd64, memory under load, `!reset` needs Compose 2.24 or newer.
