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

## Added with ADR 0004 (CSP, storage, BFF)

| # | Trap | Resolution | Feature |
|---|---|---|---|
| 41 | No CSP or security headers anywhere; XSS and clickjacking exposure. | Nonce-based CSP via Next `proxy.ts`, locked-down API CSP, gateway hardening headers; tests in smoke and headless load. | 00, 02 |
| 42 | A CSP report endpoint would be an unauthenticated write route, contradicting "nothing reachable while signed out". | No report endpoint; CI headless load fails on violations; reporting is a next step. | 00 |
| 43 | R2 needs a Cloudflare account and secrets; the reviewer has neither. | `ObjectStore` port: `fs` default in compose, R2 by config; shared contract tests. | 08 |
| 44 | Presigned URLs force browser-to-storage traffic: CSP hole, CORS, a published port. | BFF streams all file bytes; no presigned URLs for now. | 08 |
| 45 | User-uploaded images: SVG scripts, polyglots, EXIF GPS. | Magic-byte validation, re-encode to 256x256 WebP, no SVG/GIF. | 08 |
| 46 | DB row and object can diverge (orphans, dangling rows). | pending -> ready states, orphan cleanup, content-addressed objects. | 08 |
| 47 | Dev/prod mixups and over-broad storage credentials. | Separate buckets and bucket-scoped tokens; startup guard on environment mismatch; no storage credentials in CI. | 08 |
| 48 | Avatars leak profile data across tenants. | Visible only to users sharing a tenant; user-level key prefix; initials for deactivated users. | 08 |
| 49 | `sharp` is a native module; Alpine/arm64 builds can fail. | Verify in the foundation spike; fall back to a glibc slim base. | 00, 08 |
| 50 | typescript-eslint did not support TypeScript 7.0, forcing a pin to 6.x. | oxlint type-aware (tracks TS 7.0.2); pin removed. | 00 |
| 51 | oxfmt is beta; its CSS formatter lowercased font names; `stylelint --fix` stripped hand-written vendor prefixes. | Documented in ADR 0005; Tailwind re-adds prefixes (verified in built CSS); revisit triggers recorded. | 00 |
| 52 | Anti-flash theme scripts need an inline script, which a strict CSP forbids. | Theme class set server-side from a cookie; no inline script (ADR 0006). | 00, 02 |
| 53 | Tailwind does not scan classes in packages outside the app. | `@source` pointing at `packages/ui/src`; build check that utilities exist in the CSS. | 00 |
| 54 | Git hooks are bypassable (`--no-verify`) and can be slow. | Hooks are convenience only; CI is the gate; pre-commit limited to staged files. | 00 |
| 55 | Nuxt-style layers do not exist in Next.js. | Workspace packages as layers plus lint-enforced feature boundaries (ADR 0006). | 00 |
| 56 | `cap_drop: ALL` makes the stock Caddy image fail to start (file capability on the binary). | Ship a plain copy of the binary (we bind 8080); keep the hardening (found by running it). | 00 |
| 57 | The Node base image bundles npm, whose dependencies carry HIGH CVEs. | Delete npm/corepack/yarn from the runtime image (never needed there); scans clean. | 00 |
| 58 | Upstream Caddy binary has HIGH Go-stdlib CVEs with no rebuilt image. | `.trivyignore.yaml` entries with reason, scope and expiry 2026-11-30; CDN/WAF note; Dependabot bump removes them. | 00 |
| 59 | Dependabot cannot see a base image behind `ARG` in `FROM`. | Literal digest-pinned `FROM` lines. | 00 |
| 60 | Local engine is Podman (no BuildKit, no buildx, arm64, 4 GiB VM); CI is real Docker. | Document it; the first CI run (real Docker, amd64) and the publish job on merge were both green; measure Supabase stack memory before promising one-command setup. | 00, 06 |
| 61 | tmpfs `uid=` options are not portable across Docker and Podman. | Use default tmpfs; no ownership options. | 00 |
| 62 | In Next 16 `middleware` is renamed `proxy` (`proxy.ts`); our notes said middleware. | Corrected in living docs, recorded in ADR 0009. | 02 |
| 63 | Nonce CSP needs dynamic rendering; Next's example includes `upgrade-insecure-requests`, which breaks plain-HTTP localhost. | Layout is dynamic (theme cookie); omit the directive until TLS fronts the gateway; prove with a test. | 02 |
| 64 | The supplied mockup's palette fails AA in places (gold text 2.10:1, white on green 2.54:1, gray placeholder 2.56:1, light border 1.23:1). | Re-derive text-safe tokens; the contrast test enforces. | 03 |
| 65 | The mockup sums mixed deals into one currency figure, shows an SSO button and a magic-link tab, and uses CVC branding and a photograph. | Per-currency totals; no SSO/magic link; neutral brand; no copied assets. | 03 |
| 66 | "Forgot password?" is shown but no reset flow was designed. | Add password reset to feature 02. | 02 |
| 67 | `next dev` writes an agent-instruction file from a dependency. | Gitignore `apps/web/AGENTS.md`; our own AGENTS.md files are authoritative. | 00 |
| 68 | An AI PR reviewer reads untrusted diffs (prompt injection) and sends code to a model. | Comment-only token, no secrets, advisory and non-blocking, `pull_request` not `pull_request_target` (ADR 0010). | CI |
| 69 | Search-summary research went stale: GitHub Models (and the free `GITHUB_TOKEN` inference path) was retired 2026-07-30; `actions/ai-inference` v3 is Copilot-only. | Verify availability and pricing on primary pages at decision time; ADR 0010 rewritten with the correction. | CI |
| 70 | Free AI allowance is a hard cap (10,000 neurons/day) and models get retired. | Run on open/ready/label only, ~1,000 neurons per review, model configurable (`AI_MODEL`), every failure degrades to no comment. | CI |
| 71 | A model's output is untrusted: it can ping people with @mentions or forge our comment marker. | Strip HTML comments, defuse `@`, cap length, update only the bot's own marked comment. | CI |
| 72 | A `.PHONY` edit that replaced only the first line of a multi-line declaration broke the Makefile. | Caught by a check that every documented target is phony; repaired. | 00 |
| 73 | A per-second countdown on a date-only field is false precision. | Day-resolution countdown that rolls over at tenant-local midnight; hours only if a close time field is added. | 03 |
| 74 | A front-end timer cannot alert offline users, and notifications that duplicate or vanish are worse than none. | Server-side hourly scan, `<=` threshold, unique dedupe key, audited in the ledger (ADR 0011). | 05 |
| 75 | Day boundaries differ per tenant time zone (and DST outside SAST). | Judge each tenant on its local date; calendar-day maths; tests across midnight and DST. | 03, 05 |
| 76 | An unassigned deal or a deactivated assignee would silently lose the alert. | Fall back to Owner/Admins; absent assignee still notified, delegate too. | 05 |
| 77 | Alert emails can leak confidential deal names and ten deals could mean ten emails. | Generic subject, names only in the body, one digest per recipient per scan. | 05 |
| 78 | Relative or countdown times cause server/client hydration mismatches. | Server renders `closes_in_days` from the API; client recomputes after mount. | 03 |
| 79 | Minute-level countdown on the final day needs a close time, time-zone/DST-safe maths and an accurate clock; a wrong laptop clock shows wrong hours. | Optional `expected_close_time` in the tenant zone; client offset from the API `Date` header; parity tests with the SQL function; DST test days. | 03 |
| 80 | An hourly scan makes the overdue alert up to an hour late. | Accepted and documented; the countdown itself is exact. | 05 |
| 81 | Alert emails need a deal link, but a link built from request headers allows host-header injection and a link carrying a token would be a credential. | `{PUBLIC_BASE_URL}` from configuration, no token, no action; sign-in required; subject never names a deal. | 05 |
| 82 | Coverage reported 100% while counting only the files tests loaded (including the test setup file) and none of the untested app code. | Count every source file (`coverage.include`); thresholds; proven to fail on a planted untested file (ADR 0012). | 00 |
| 83 | Coverage measures lines run, not bugs caught. | Treat thresholds as a backstop; mutation testing on domain code is the next step. | 00 |
| 84 | Real-looking R2 credentials appeared in the tracked `.env.example` (working tree only). | Verified never staged, committed or pushed; moved to the gitignored `.env`; template is placeholders only; guard in the hook, CI and `make env-check` reports names and lines, never values; rotate if exposed. | 00, 08 |
| 85 | R2 tokens scope to buckets, not prefixes, so one bucket with `Dev/` and `Prod/` lets a dev token reach prod data. | Prefix always prepended by the store, startup guard, per-environment tokens; separate prod bucket recommended. | 08 |
| 86 | Config copied from another project brought a public `r2.dev` URL and a bucket-name prefix. | Public URL rejected (BFF streams only); key prefix instead of bucket-name prefix; generic `STORAGE_*` names. | 08 |
| 87 | The official Supabase compose replaced Kong with Envoy, makes the gateway wait on Studio, sets no memory limits, includes no mail service and publishes 8000/5432/6543. | Trimmed five-service stack with an override, internal network, Mailpit (ADR 0013). | 00 |
| 88 | The Envoy gateway denies the anon key on the REST root (403): an RBAC behaviour change from Kong. | Test real endpoints; service-role key only in jobs. | 00 |
| 89 | `pg_cron`, `pgcrypto` and `pgTAP` were unverified assumptions. | Verified in the Supabase Postgres 17.6 image (pg_cron preloaded; sha256 digest correct). | 00, 05 |
| 90 | R2 region value is undocumented on the token page; `WEUR` is a location hint, not an S3 region. | Assume `auto`; verify in the storage spike. | 08 |
| 91 | The Supabase db image's init runner uses `ON_ERROR_STOP`: one failing init script silently skipped all later ones (realtime schema, image migrations) while the database reported healthy. | Trimmed `roles.sql` in the vendor script; smoke and pgTAP assert the realtime schema and publication exist (ADR 0014). | 00 |
| 92 | GoTrue sent SMTP credentials to Mailpit and failed with `unencrypted connection` (HTTP 500 on password recovery). | Send no SMTP credentials to Mailpit; recovery mail verified in the smoke test. | 00 |
| 93 | Envoy answers HTTP/1.0 with 426 and returns 503 until its upstreams are healthy, so a naive healthcheck is wrong either way. | HTTP/1.1 probe of real routes with the right keys (ADR 0014). | 00 |
| 94 | Several smoke checks passed for the wrong reason (a curl probe of non-HTTP Postgres, `wget` accepting any HTTP 4xx as unreachable, an HTTPS probe from an image without HTTPS). | Replaced by `/dev/tcp` port probes and plain HTTP; sabotage run proves each check fails when the property is broken. | 00 |
| 95 | A previous edit had truncated the `ci-local` Makefile target (dropped four gates and the help text). | Restored; keep the target in step with CI. | 00 |
| 96 | The Envoy gateway compares `apikey` by exact string, so random per-start keys break it. | Keys derived deterministically from `JWT_SECRET` (ADR 0014). | 00 |
| 97 | R2's region: Cloudflare's AWS SDK v3 example uses `auto` ("required by SDK but not used by R2"). Replaces the assumption in row 90. | Use `auto`; also works against an S3-compatible container with path-style addressing. | 08 |
| 98 | The image's `auth.uid()` reads only the legacy `request.jwt.claim.sub` setting, but our PostgREST runs with `PGRST_DB_USE_LEGACY_GUCS=false` and sets only `request.jwt.claims`. Through the API `auth.uid()` would be null, and every policy using it would deny (or, worse, a careless one allow). | Migration 20261027 defines `app.uid()` reading `request.jwt.claims` first, then the legacy setting; policies and triggers use it, never `auth.uid()`. **Not yet verified through a real PostgREST request**; do that in feature 02/03. | 01 |
| 99 | Roles that own the tables (`postgres`, `service_role`) have `BYPASSRLS` in the Supabase image, so `FORCE ROW LEVEL SECURITY` does not bind them. | Immutability does not rely on RLS: revoked privileges plus row and TRUNCATE triggers, tested as superuser, `service_role` and `authenticated`. | 01 |
| 100 | `auth.users` has no `email_confirmed_at` until GoTrue's own migrations run, and once they do `confirmed_at` is a **generated** column, `LEAST(email_confirmed_at, phone_confirmed_at)`. Tests that ran against the bare database image saw a different table from the real stack (an earlier version of this row wrongly blamed the image), and a check on `confirmed_at` would accept a phone-only confirmation. | `create_tenant` checks `email_confirmed_at` (migration 20261031), fixtures insert `email_confirmed_at`, a test covers phone-only, and `make test-db` now starts `auth` so pgTAP sees the real schema. | 01, 02 |
