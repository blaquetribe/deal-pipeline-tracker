# 05 Realtime: progress

Status: done (core realtime notifications shipped; presence is cut-list scope)
Owner/branch: main
Depends on: 03

## Goal
WebSocket relay of RLS-filtered events, live cache updates, presence. Covers GOTCHAS rows 13, 14.

## Scope
- In: WebSocket relay of RLS-filtered events with live cache updates; **notifications** (closing-soon alerts at 5 days, 1 day and overdue: hourly idempotent `scan_closing_soon`, `notifications` rows pushed over the tenant-scoped socket, bell/toast/live region, email digest with deal details and a deal link through the Mailer with `email_outbox`; ADR 0011); presence (cut-list item).
- Out: presence (cut-list scope, noted in `README.md` and `docs/PROGRESS.md`); alert preference controls and absence/delegation recipient resolution remain follow-up.

## Design notes
- Follow ADR 0002: the browser connects only to the same-origin `/ws` BFF endpoint; the API authenticates the opaque session cookie, validates Origin, binds the connection to the active tenant, and subscribes to Supabase Realtime using the caller's user JWT so PostgreSQL RLS authorizes every delivered row.
- The stack spike in `docs/features/00-foundation/supabase-stack.md` verified RLS-filtered `postgres_changes` with a user JWT held by the API and verified Caddy WebSocket pass-through. Revalidate it against the merged current stack and add regression tests.
- Closing-soon notifications follow ADR 0011 and `docs/features/03-deals-core/closing-soon.md`: hourly idempotent database scan, tenant-scoped notifications, audit events, and queued email through the existing Mailer. Presence is explicitly cut-list scope.

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s)
- [x] API
- [x] Web
- [x] Docs updated (local verification and PR #15 CI)

## Tests
What is covered, where it lives, how to run it.
- `pnpm --filter @dpt/api exec vitest run src/features/notifications src/features/realtime src/db/realtime.test.ts src/email/closing-soon-worker.test.ts`: auth/tenant gates, Origin rejection, rate limit, relay filtering, session revocation/token rotation, upstream failure, digest grouping, invalid payload, safe logging and retry behavior.
- `pnpm test:coverage`: 551 tests; 94.57% statements, 85.06% branches; API branch coverage 92.30%.
- `KEEP_UP=1 COMPOSE_PROJECT_NAME=dpt-feature05-final GATEWAY_PORT=8092 PUBLIC_BASE_URL=http://localhost:8092 scripts/compose-smoke.sh`: full isolated compose smoke passes, including API WebSocket access, pgTAP, exposure checks and negative migration validation.
- `COMPOSE_PROJECT_NAME=dpt-feature05-final docker-compose exec -T db sh /tests/run.sh`: 24 pgTAP files, 477 assertions (isolated task compose project).

## Security checklist (from SECURITY_STANDARDS.md)
- [x] New tables have `tenant_id`, RLS enabled and forced, policies, tests for each role and cross-tenant.
- [x] New routes declare auth and permission; signed-out test passes.
- [x] No client-supplied tenant/author/role/timestamp is trusted.
- [x] Append-only data cannot be mutated by any role including owner/service.
- [x] Inputs validated by zod; errors do not leak internals.
- [x] No secrets, tokens, or PII in logs.
- [x] Web still has no Supabase dependency.

## Log
Dated notes: what changed, what was learned, problems.
- 2026-10-28: started from clean `main` at `e1fd24c` after PRs #13 and #14 merged with all required checks green. Existing compose spike evidence covers JWT-filtered Realtime and Caddy `/ws`; implementation must preserve the API-only Supabase boundary, session/tenant isolation, and reconnect cache refresh behavior.
- 2026-10-28: implemented RLS-backed per-user WebSocket delivery, notification list/read APIs and bell UI, hourly closing-soon scan, append-only system audit event, leased email outbox and generic digest template. Local Vitest, coverage, pgTAP, typecheck, lint, stylelint, format, production build and full isolated compose smoke pass. Captured authenticated notification UI at mobile and desktop widths; GitHub CI remains before merge.
- 2026-10-29: live UI validation exposed an initialization race: Realtime's first channel join could precede caller-JWT setup, and the user-id filter was not accepted by the active Realtime schema. The API now awaits `setAuth` before subscribing and uses the active-tenant filter while RLS continues to authorize rows. Browser verification received a new closing-soon alert and displayed the connected state. Added regression coverage for token rotation and disconnect during async initialization. Local verification passes: 551 tests, coverage gates (85.06% global branches; 92.30% API branches), formatting, lint, stylelint, typecheck, build, and the full isolated compose smoke. PR #15 merged to `main` after all required GitHub checks passed: secret scan, typecheck/lint/test/build, pgTAP, API/web/gateway image jobs and compose smoke; advisory AI review passed.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- Presence remains cut-list scope. Alert thresholds are currently database defaults (`[5, 1]` days and overdue enabled); no Owner/Admin preference API/UI exists. Recipients are active deal assignees, falling back to active Owner/Admin if a deal has no assignees; absence/delegation and broader team membership are not modeled here. The per-user dedupe key includes the recipient ID. Email retries are leased and bounded; a successful SMTP send followed by failed completion persistence can cause a duplicate on lease recovery. These choices need product/architecture review before claiming broader team notification semantics.
- The first production image smoke revealed that bundling `ws` into ESM left a dynamic CommonJS `require("events")` that crashes at runtime. The API now externalizes `ws` and copies only that package into the runtime image; the full compose smoke confirms startup and realtime connectivity. The mobile screenshot also revealed and fixed the notification popover's off-screen anchor.
