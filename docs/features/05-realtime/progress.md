# 05 Realtime: progress

Status: in progress (closing-alert preferences and delegate-aware recipients are implemented locally; pending review)
Owner: feature 05; active branch `codex/feature-05-alert-preferences` (pending PR)
Depends on: 03

## Goal
WebSocket relay of RLS-filtered events, live cache updates, presence. Covers GOTCHAS rows 13, 14.

## Scope
- In: WebSocket relay of RLS-filtered events with live cache updates; **notifications** (closing-soon alerts at 5 days, 1 day and overdue: hourly idempotent `scan_closing_soon`, `notifications` rows pushed over the tenant-scoped socket, bell/toast/live region, email digest with deal details and a deal link through the Mailer with `email_outbox`; ADR 0011); presence (cut-list item).
- Out: presence (cut-list scope, noted in `README.md` and `docs/PROGRESS.md`).

## Design notes
- Follow ADR 0002: the browser connects only to the same-origin `/ws` BFF endpoint; the API authenticates the opaque session cookie, validates Origin, binds the connection to the active tenant, and subscribes to Supabase Realtime using the caller's user JWT so PostgreSQL RLS authorizes every delivered row.
- The stack spike in `docs/features/00-foundation/supabase-stack.md` verified RLS-filtered `postgres_changes` with a user JWT held by the API and verified Caddy WebSocket pass-through. Revalidate it against the merged current stack and add regression tests.
- Closing-soon notifications follow ADR 0011 and `docs/features/03-deals-core/closing-soon.md`: hourly idempotent database scan, tenant-scoped notifications, audit events, and queued email through the existing Mailer. Presence is explicitly cut-list scope.

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s)
- [x] API
- [x] Web
- [x] Tenant-scoped alert preferences with Owner/Admin authorization, audit trail, and an organisation settings page
- [x] Alert recipients include active deal assignees, valid active delegates, optional IC/all-member groups, and Owner/Admin fallback
- [x] Handover and feature documentation updated
- [ ] Final diff review and PR

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
- 2026-10-30: implemented the accepted ADR 0011 follow-up: Owner/Admins can configure up to ten pre-close thresholds, overdue alerts, and optional IC/all-member recipients. Added audited settings RPCs, validation, and a shared `/settings` form. Closing alerts now notify the active deal team and any valid active delegate; they fall back to active Owner/Admins when there are no active assignees. Empty thresholds disable pre-close reminders while the overdue switch remains independent. Added tenant-bound pgTAP coverage for settings authorization, audit, recipient groups, delegation, deduplication, and cross-tenant isolation. Full pgTAP passes (630 assertions). Full Vitest/coverage passes (675 passed, 1 skipped; 85.02% branch coverage), typecheck, lint, Stylelint, format check, and production build pass. GitHub CI is subject to the repository billing/spending block described in the handoff.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- Presence remains cut-list scope. Closing-alert preferences are tenant-wide and editable by members with `member.manage`; custom roles granted that permission also qualify, consistent with capability-based authorization. Delegation is additive: the absent principal remains notified and an eligible active delegate is included. `ic` recipients are active members with `approval.decide`. The per-user dedupe key includes recipient ID, so changing recipients does not duplicate alerts already sent for a threshold. Email retries are leased and bounded; a successful SMTP send followed by failed completion persistence can cause a duplicate on lease recovery.
- The first production image smoke revealed that bundling `ws` into ESM left a dynamic CommonJS `require("events")` that crashes at runtime. The API now externalizes `ws` and copies only that package into the runtime image; the full compose smoke confirms startup and realtime connectivity. The mobile screenshot also revealed and fixed the notification popover's off-screen anchor.
