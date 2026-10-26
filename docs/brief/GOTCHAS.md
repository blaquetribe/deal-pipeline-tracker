# Brief Gaps and Gotchas (traceability)

Each row: what the brief says, the trap, how we handle it, which feature owns it. Update status as features land.

| # | Brief wording | Trap / deliberate gap | Our handling | Feature |
|---|---|---|---|---|
| 1 | "No page or API route reachable while signed out" | Open sign-up forces some public routes (sign-up, verify, login, accept-invite). Hono is a separate service, so it is directly reachable, not only via Next. `/ws`, `/health`, static assets, Next `_next/*` also count. | Default-deny middleware in BOTH web and api; explicit, minimal public allowlist documented here and tested (a test enumerates all routes and asserts 401 unless allowlisted). Health endpoint exposes no data. | 02 |
| 2 | "Cannot be edited or deleted once posted" | RLS alone does not bind the table owner / service role / superuser. `ON DELETE CASCADE` from deals would delete notes. TRUNCATE bypasses row triggers. Client-supplied author/timestamp can be forged. | Revoke UPDATE/DELETE/TRUNCATE; BEFORE UPDATE/DELETE trigger raising an exception; statement-level TRUNCATE trigger; FKs `RESTRICT`; deals/tenants soft-delete only; `author_id` and `created_at` set by DB defaults (`auth.uid()`, `now()`), never from the client. Tested as owner and as service role. | 01 |
| 3 | "Changes captured in the repo, not applied by hand" | Studio/dashboard edits and ad-hoc SQL; seed users cannot be created by plain SQL. | Only `supabase/migrations/*.sql`; CI applies from scratch and fails on drift; seed users via a scripted admin-API step committed in repo. | 00, 01 |
| 4 | "Not just hiding a button in the UI" | UI-only checks are worthless; but we also chose a UI that knows nothing of Supabase. | RLS is the real gate; Hono guards mirror it; web has no Supabase dependency (lint rule + dependency check in CI). Negative tests per role. | 01-04 |
| 5 | "Auth behind a single module" | Supabase calls scattered in handlers. | Only `apps/api/src/auth/*` imports Supabase Auth; web has one `useSession` hook. Lint rule `no-restricted-imports`. | 02 |
| 6 | "docker compose up ... sign in ... seeded data" | Must work on a clean machine: image arch (Apple Silicon vs x86), startup ordering, no manual `.env`, seed idempotency, first-run time. | `.env.example` with clearly-marked dev-only keys committed and defaulted; healthchecks + `depends_on: condition`; idempotent seed; documented credentials; verified from a fresh clone. | 00, 06 |
| 7 | "Private repo" | Secrets in git history. | No real secrets ever; dev keys obviously fake; secret scan in CI. | 00 |
| 8 | Pipeline stages + "Passed" | Unspecified: can Passed occur from any stage? Backward moves? Is Closed terminal? | State machine in `packages/shared`, enforced in DB (trigger/function) and API. Passed from any non-terminal stage with mandatory reason; Signed/Closed/Passed terminal-ish rules recorded in ADR. Stage history is itself append-only. | 03 |
| 9 | "Coming up for closing soon" | Needs an expected close date; definition of "soon" unspecified; Passed/Closed must be excluded; timezone. | `expected_close_date` (date, no tz); default 30-day window, configurable; excludes Closed/Passed. | 03 |
| 10 | "Whatever detail a deal team needs" | Money as float; currency; dates. | Amounts as integer minor units (`bigint`) + ISO-4217 currency; default ZAR; no floats anywhere. | 03 |
| 11 | "Claude Code reflection" | The brief says "above" but only asks for a README on AI use. | Keep `docs/AI_USAGE.md` as a running log from day one; fold into README. | all |
| 12 | "If not all addressed, note in README" | Scope here (multi-tenant, approvals, realtime, invites) exceeds 6-10h by our own choice. | Core vs cut list in `docs/PROGRESS.md`; honest README note. | all |
| 13 | Realtime (our addition) | Supabase Realtime `postgres_changes`: DELETE events carry only primary key and are not RLS-filtered; RLS evaluated per subscriber (cost). | Rows are never hard-deleted (soft delete = UPDATE, which is filtered); tenant filter AND RLS; test that tenant A never receives tenant B events. | 05 |
| 14 | Cookie sessions + WebSocket (our addition) | CSRF on mutating routes; Cross-Site WebSocket Hijacking. | SameSite cookie, Origin check on `/ws` upgrade and on mutating requests, CSRF token for unsafe methods. | 02, 05 |
| 15 | Multi-tenancy (our addition) | Tenant id spoofing, cross-tenant FKs (note in tenant A pointing to deal in tenant B), stale cache across tenant switch. | Membership checked in RLS (not trusted from claim); composite FKs / constraints tie child tenant to parent tenant; query keys include tenant id. | 01, 05 |
| 16 | Roles / approvals (our addition) | Self-approval, role escalation, last owner removal, conflicting duties, delegation abuse. | See `docs/standards/SECURITY_STANDARDS.md` section RBAC and SoD; enforced in DB functions, tested. | 04 |
| 17 | Stretch extraction | Sending documents to a third-party model exposes data; untrusted file uploads. | Only if time allows; documented, size/type limits, tenant-scoped storage. | 07 |
| 18 | Tokens (verify/invite) | Token leakage, replay, enumeration. | 32 random bytes, hash stored, single-use, expiry, email-bound, constant-time compare, generic responses, rate limits. | 02 |

## Added after architect review (ADR 0002)

"Notes" column = item number in `docs/PRESENTATION_NOTES.md`, which has the full reasoning. Items marked *verify* need a spike before we state them as fact.

| # | Notes | Trap | Resolution | Feature |
|---|---|---|---|---|
| 19 | 1 | Route handlers cannot cleanly proxy WebSocket upgrades; `/ws` is required (*verify* Next rewrites). | Gateway container (Caddy/nginx): `/` web, `/api` and `/ws` api; single origin. | 00, 05 |
| 20 | 2 | Published Supabase ports (Studio, PostgREST) bypass the UI/API boundary; rules only in Hono are bypassable with a valid JWT. | Only the gateway publishes a port; rules in DB functions; no direct write grants on core tables. | 00, 01 |
| 21 | 3 | Token expiry/refresh races log users out; sockets outlive tokens. | Server-side sessions, single-flight refresh, sockets tied to the session. | 02, 05 |
| 22 | 4 | Several append-only tables multiply the mechanism; field changes were unaudited. | One `deal_events` ledger incl. field and stage changes. | 01, 03 |
| 23 | 5 | Table owner/DBA can disable triggers. | Per-deal hash chain + `verify_ledger`; honest tamper-evident claim. | 01 |
| 24 | 6 | POPIA erasure vs permanent records; cross-tenant profile leakage via author joins. | Deactivate not delete; actor snapshot; tenant-scoped user directory. | 01, 02 |
| 25 | 7 | Vanilla Postgres lacks `auth` schema and roles. | CI on Supabase Postgres image / `supabase start`. | 00 |
| 26 | 8 | Default `EXECUTE` to PUBLIC; per-row RLS cost. | Revoke/grant explicitly; `(select auth.uid())`; indexes. | 01 |
| 27 | 9 | Concurrent stage moves / final approvals double-count. | `version` column, row locks, idempotent transitions. | 03, 04 |
| 28 | 10 | Next middleware-only auth was bypassable (CVE-2025-29927; *verify* fix version). | API is the gate; middleware UX only; pinned patched Next; gateway strips internal headers. | 02 |
| 29 | 11 | Open sign-up + invites = email abuse / org impersonation. | Rate limits, invite caps, inviter shown, verification before tenant. | 02 |
| 30 | 12 | `postgres_changes` vs broadcast-from-database. | postgres_changes now (INSERT-only ledger, soft deletes); broadcast = scale path (*verify* with a spike). | 05 |
| 31 | 13 | Custom tokens vs GoTrue flow. | Own tokens; `email_confirm: false` until consumed. | 02 |
| 32 | 14 | "Required fields at a given step" implies stage-gated fields. | Stage requirements enforced in `move_stage`. | 03 |
| 33 | 15 | Summing mixed currencies. | Per-currency totals. | 03 |
| 34 | 16 | Static seed dates make "closing soon" empty later. | Seed relative to now; CI clock-shift check. | 06 |
| 35 | 17 | Need-to-know access between deal teams. | Tenant-level only; documented limit. | 01, README |
| 36 | 18 | "CI/CD" has a D; "live database" hints at hosted project. | CI always; CD = build+push images; documented `db push` path. | 00 |
| 37 | 19 | Full Supabase stack is heavy; ARM/x86; port clashes. | Pinned multi-arch images, gateway-only port, documented RAM and first-run time. | 00, 06 |
| 38 | 20 | Seed credentials in a financial context; real names. | Dev-flag gated, documented dev-only, fictional data, no CVC branding. | 06 |
| 39 | 21 | Users must correct mistakes in an immutable trail. | `amends_event_id`. | 03 |
| 40 | 22 | AI use must be core, not bolt-on. | Small commits, `.claude/` hooks/commands, `AI_USAGE.md`. | all |
