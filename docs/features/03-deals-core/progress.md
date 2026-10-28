# 03 Deals core: progress

Status: in progress (deal create/list/stage/assignment/update/detail/activity/notes and closing-soon dashboard are implemented; server alerts depend on features 02 and 05)
Owner/branch: feat/02-api-auth (continuing the existing working tree; do not branch-reset or replace)
Depends on: 01, 02

## Goal
Deal CRUD, stage state machine, notes UI, pipeline overview, closing soon. Covers GOTCHAS rows 8, 9, 10.

## Scope
- In: deals CRUD with `expected_close_date` and an **optional `expected_close_time`**, **deal assignees (owner, lead, members; not access control)**, stage machine with required fields per stage, notes/decisions via the ledger, Dashboard (KPI row, pipeline overview, **Closing soon list with a live countdown (days, and hours and minutes on the final day), 60-day window**, per-currency totals), Deals list (stage tabs, filters, server-side pagination), Deal detail (Overview, Activity with integrity cue). Countdown and alerts: `closing-soon.md` (ADR 0011). UI direction: ADR 0009 and `docs/design/mockup-review.md`.
- Out (and where it goes):

## Design notes
Key decisions, schema/API shape, links to ADRs.
- Deal responsibility is stored in `deal_assignees` as owner, lead or member; it does not grant visibility. Assignment mutations require `deal.edit`, active tenant membership, an expected deal version and produce a ledger event.
- The first list contract is `list_deals`: tenant scope comes from the server-side active session, filters and pagination are bounded in Postgres, and `amount` crosses JSON as an integer string (E10).
- The current list provides the keyboard-accessible “Move to…” stage control through the existing database stage machine. Kanban remains an extended UI item per ADR 0009; if added, drag-and-drop must stay an enhancement to this accessible path and target smooth 60 fps motion.
- API routes use the authenticated user JWT and Postgres remains the authorization boundary. No browser Supabase client was added.

## Tasks
- [x] Database security tests for assignments and deal list, including cross-tenant, permission, anonymous, stale-version and null-parameter cases.
- [x] Additive migrations for assignees, assignment reads, deal list, fail-closed null guards, tenant-authorized detail/activity reads, exact bigint cursors, and dashboard summary (`20261107000000` through `20261114000000`).
- [x] Session-gated API for deal list and assignment reads/replacement.
- [x] Session-gated deal creation through the existing database function.
- [x] Session-gated stage movement through the existing database state machine with optimistic versioning.
- [x] Dashboard deal create/list with server-side stage/search filters, pagination, empty/error/loading states, and exact minor-unit formatting.
- [x] Optimistic deal updates through a strict API allow-list and accessible edit form.
- [x] Tenant-authorized detail and activity APIs; exact bigint sequence cursors; append-only note API and UI; visible integrity result and accessible ordered timeline.
- [x] Bounded activity pagination with exact bigint cursors.
- [x] Tenant-local 60-day closing-soon summary, per-currency open pipeline totals, stage counts, and live countdown with day/minute-aligned refreshes and clock-skew correction.
- [ ] Server-side closing alerts and delivery (owned across feature 02 mail and feature 05 realtime; see `closing-soon.md`).
- [x] Progress and handoff docs updated for this slice.

## Tests
What is covered, where it lives, how to run it.
- `pnpm test`: 34 files and 450 tests pass. Focused route, dashboard, detail, countdown and shared-schema tests pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm stylelint`, `pnpm format:check`, `pnpm build`, `make COMPOSE='podman compose' test-db` (408 assertions across 21 files), and full Podman compose smoke pass. `pnpm test:coverage` runs all 450 tests but fails repository thresholds (68.15% global statements; 86.95% statements for `apps/api/src`; required floors are 90% and 95%). GitHub CI skips build after the coverage failure. Most uncovered paths are in auth/onboarding code already included in this branch; see `docs/HANDOFF.md` before treating CI as green.
- Browser evidence: authenticated deal detail with a saved note captured on 2026-10-28; dashboard evidence with a deal due in 12 days captured on 2026-10-28.

## Security checklist (from SECURITY_STANDARDS.md)
- [x] The new assignment table has `tenant_id`, forced RLS, role tests and cross-tenant tests.
- [x] Assignment read/write routes are session-gated and declare `deal.view` / `deal.edit`; signed-out and CSRF tests pass.
- [x] Deal create/list and assignment APIs derive tenant and author context from the active session/database; no client-supplied tenant/author/role/timestamp is trusted.
- [x] Deal notes use the append-only event ledger and expose no edit/delete action; pgTAP verifies activity reads and ledger integrity.
- [x] Assignment and list inputs are schema-validated; errors do not expose database details.
- [ ] No secrets, tokens, or PII in logs.
- [ ] Web still has no Supabase dependency.

## Log
Dated notes: what changed, what was learned, problems.
- 2026-10-28: Added tenant-scoped deal assignments with `owner | lead | member`, versioned set operation, ledger audit, authenticated RLS read RPC and bounded tenant deal-list RPC. Added session-gated deal create and stage-move APIs plus accessible dashboard controls for creating and moving deals; Postgres remains authoritative for stage transitions. Full Vitest passes (432 tests); pgTAP passes (373 assertions across 19 files); production build and full compose smoke pass. SQL fixture role seeding is now scoped to fixture tenants after local persistent data exposed tests that assumed the database contained no other tenants. A review caught that explicit SQL NULL could bypass ordinary numeric bound comparisons, so a separate forward migration now guards null versions/limits/offsets. Kanban drag-and-drop is deferred; preserve the accessible move control and target smooth 60 fps motion if implemented.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").

- 2026-10-28 (later): Added strict optimistic deal updates, SQL NULL guards for stage/update version checks, tenant-scoped deal detail and activity reads, session-gated APIs, and a detail page with exact money display, integrity cue, ordered event timeline, append-only note composer and bounded older-event pagination. Preserved the applied migration checksum by moving exact bigint cursor serialization to migration 13. Vitest passes 445 tests; typecheck, lint, stylelint, format check, build, pgTAP (396 assertions/20 files) and compose smoke pass. Captured the authenticated detail page with a saved test note. Kanban drag-and-drop remains deferred; keep the keyboard move control and target smooth 60 fps if implemented.
- 2026-10-28 (later): Added a database-authorized dashboard summary for per-stage counts, per-currency open pipeline totals and tenant-local closing dates. The browser shows a 60-day closing-soon list, timezone-aware countdown chips, and minute/midnight-aligned updates using the API's server clock. Vitest passes 450 tests; typecheck, lint, stylelint, format check and build pass; pgTAP passes 408 assertions across 21 files. Server alert delivery remains with feature 02/05 dependencies.
- 2026-10-28 (later): Coverage follow-up adds API route, dashboard, detail and money edge-state tests without changing the deal UI or database. The suite now passes 502 tests and global branch coverage meets the gate at 85.04%. Existing dashboard evidence remains applicable because this follow-up only changes tests and API error mapping.
