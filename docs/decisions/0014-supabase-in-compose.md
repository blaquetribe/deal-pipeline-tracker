# ADR 0014: Integrating the Supabase stack into compose

Status: accepted. Implements ADR 0013. Everything below was run unless marked **unverified**.

## Decisions
1. **Five services on an `internal: true` network** (`db`, `auth`, `rest`, `realtime`, `supabase-gateway` = Envoy). Only the Caddy `gateway` publishes a host port. `api` joins both `edge` and `internal`; Mailpit joins both so the dev Caddy can serve `/mail/`.
2. **Derived keys.** The Envoy gateway compares the `apikey` header by exact string, so the anon and service-role keys must be deterministic. They are derived from `JWT_SECRET` with fixed claims (`{"role":…,"iss":"supabase","iat":1700000000,"exp":4102444800}`, HS256). The gateway entrypoint derives them with `openssl`; `scripts/supabase-keys.mjs` and the smoke test use the same algorithm and a test cross-checks Node against the shell. No JWT is committed, and one secret rotates everything.
3. **Zero-setup, dev-only defaults.** `docker compose up` works with no `.env`: secrets default to clearly named `dev-only-…` values (YAML anchors in `x-dev-secrets`). The stack is unreachable from outside the host except through Caddy, so the defaults grant nothing a reviewer does not already have. `make env` writes random per-machine secrets into the untracked `.env` (missing keys only, mode 600, prints key names, never values). Production must set real values; `.env.example` stays placeholders only.
4. **Mailpit through a dev-only Caddyfile.** `gateway/Caddyfile.dev` adds `/mail*`; the shipped `gateway/Caddyfile` is unchanged because the inbox is unauthenticated.
5. **Vendored files are not ours.** `supabase/db/init/*` and `supabase/gateway/*` (except `healthcheck.sh`) come from supabase/supabase commit `f4d6d90` through `scripts/vendor-supabase.py`, which asserts the shape of each file and records provenance in `supabase/UPSTREAM.md`. They are excluded from the formatter so they stay diffable.
6. **A real-route healthcheck** (`supabase/gateway/healthcheck.sh`): Envoy is "up" before its upstreams are. The check requires 200 on auth health and the REST root and not-503 on realtime. Proven to fail when `rest` is stopped.
7. **Migrations without the Supabase CLI.** `supabase/migrate.sh` (one-shot `migrate` service) applies `supabase/migrations/*.sql` in order, one transaction each, records a checksum, refuses an edited applied migration, uses the CLI-compatible `schema_migrations` table, and seeds only when `SEED_DEV_DATA=true`.
8. **pgTAP without the CLI.** `supabase/tests/run.sh` runs `*.test.sql` through psql in the db container and parses TAP itself; `make test-db` and the CI job `test-db` use it.
9. **Smoke test as the contract.** `scripts/compose-smoke.sh` checks health of nine services, exposure, internal reachability, no internet egress, auth/REST/realtime behaviour, mail delivery, migrations and pgTAP, and the negative cases. Its checks were weakened-and-restored (sabotage) to prove they can fail.

## Why
Reviewers get one command and no accounts; the security boundary is the network, not secrecy of dev values; every vendored byte can be re-derived and diffed.

## Consequences
- Re-vendoring is a script run plus a diff review.
- The db image's init runner uses `ON_ERROR_STOP`: one failing init script silently skips all later ones while the database still reports healthy. Our trimmed `roles.sql` exists because of this.
- `up --wait` with an exited one-shot (`migrate`) is **unverified on real Docker** (verified with the local compose); CI will show it.

## Verified versus open
Verified: full smoke from clean state; sabotage run fails exactly the four intended checks; pgTAP 11/11; migrate idempotent and tamper-refusing; spikes in `docs/features/00-foundation/supabase-stack.md`. Open: Docker Desktop and Linux amd64 behaviour of the whole stack, Trivy scan of third-party Supabase images, memory under load.
