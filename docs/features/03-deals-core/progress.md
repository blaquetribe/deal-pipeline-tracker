# 03 Deals core: progress

Status: done (core deal flows, closing-soon dashboard, and server-side alerts are implemented)
Owner/branch: main
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
- The deal list provides keyboard-accessible “Move to…” stage controls; Board view adds drag-and-drop as an enhancement to those controls, using the existing database stage machine and version checks. The board currently covers the same bounded, paginated result set as List view.
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
- [x] Server-side closing alerts and delivery through the Feature 02 mailer and Feature 05 realtime path (see `closing-soon.md` and `docs/features/05-realtime/progress.md`).
- [x] Progress and handoff docs updated for this slice.
- [x] Board view with seven stages, valid-transition drop targets, reduced-motion-aware feedback, and preserved keyboard move controls.

## Tests
What is covered, where it lives, how to run it.
- `pnpm test`: 34 files and 450 tests pass. Focused route, dashboard, detail, countdown and shared-schema tests pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm stylelint`, `pnpm format:check`, `pnpm build`, `make COMPOSE='podman compose' test-db` (408 assertions across 21 files), and full Podman compose smoke pass. `pnpm test:coverage` runs all 450 tests but fails repository thresholds (68.15% global statements; 86.95% statements for `apps/api/src`; required floors are 90% and 95%). GitHub CI skips build after the coverage failure. Most uncovered paths are in auth/onboarding code already included in this branch; see `docs/HANDOFF.md` before treating CI as green.
- Current authenticated UI evidence: [deal board](../../evidence/ui/01-deal-board.png) and [deal activity](../../evidence/ui/02-deal-activity.png), captured from the seeded Asteron demo after PR #35. The activity capture shows the readable system closing-alert event; assignment formatting is covered by tests but still needs live visual confirmation. The expected-close date formatting was changed after this capture and also needs a refreshed screenshot. These are baseline captures for the remaining DoorSprint-informed UI pass.

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
- 2026-10-29: The deal activity timeline formats legacy assignee snapshots and system closing-soon alerts as readable summaries, suppressing raw IDs and recipient JSON. A production activity event exposed a contract mismatch: system events have no user ID, use the literal `system` attribution, and include `closing_soon_alert`; the API had rejected all three. The API/shared schemas now accept this established event shape. The ledger and migrations remain unchanged. Current authenticated board and activity baseline screenshots are under `docs/evidence/ui/`; final live verification remains pending.
- 2026-10-28: Added tenant-scoped deal assignments with `owner | lead | member`, versioned set operation, ledger audit, authenticated RLS read RPC and bounded tenant deal-list RPC. Added session-gated deal create and stage-move APIs plus accessible dashboard controls for creating and moving deals; Postgres remains authoritative for stage transitions. Full Vitest passes (432 tests); pgTAP passes (373 assertions across 19 files); production build and full compose smoke pass. SQL fixture role seeding is now scoped to fixture tenants after local persistent data exposed tests that assumed the database contained no other tenants. A review caught that explicit SQL NULL could bypass ordinary numeric bound comparisons, so a separate forward migration now guards null versions/limits/offsets. Kanban drag-and-drop is deferred; preserve the accessible move control and target smooth 60 fps motion if implemented.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").

- 2026-10-28 (later): Added strict optimistic deal updates, SQL NULL guards for stage/update version checks, tenant-scoped deal detail and activity reads, session-gated APIs, and a detail page with exact money display, integrity cue, ordered event timeline, append-only note composer and bounded older-event pagination. Preserved the applied migration checksum by moving exact bigint cursor serialization to migration 13. Vitest passes 445 tests; typecheck, lint, stylelint, format check, build, pgTAP (396 assertions/20 files) and compose smoke pass. Captured the authenticated detail page with a saved test note. Kanban drag-and-drop remains deferred; keep the keyboard move control and target smooth 60 fps if implemented.
- 2026-10-28 (later): Added a database-authorized dashboard summary for per-stage counts, per-currency open pipeline totals and tenant-local closing dates. The browser shows a 60-day closing-soon list, timezone-aware countdown chips, and minute/midnight-aligned updates using the API's server clock. Vitest passes 450 tests; typecheck, lint, stylelint, format check and build pass; pgTAP passes 408 assertions across 21 files. Server alert delivery remains with feature 02/05 dependencies.
- 2026-10-29: Feature 05 delivered the hourly closing-soon scan, idempotent in-app alerts, realtime delivery, and grouped email digest. PR #15 merged after all required CI checks passed. Alert recipient preferences, absence/delegation handling, and presence remain documented follow-up scope.
- 2026-10-28 (later): Coverage follow-up adds API route, dashboard, detail and money edge-state tests without changing the deal UI or database. The suite now passes 502 tests and global branch coverage meets the gate at 85.04%. Existing dashboard evidence remains applicable because this follow-up only changes tests and API error mapping.
- 2026-10-29: PR #34 added the seven-stage Board/List switch, valid-transition drop targets and keyboard-accessible list controls; PR #35 made legacy assignment events readable. Both merged after all required CI checks passed. Live local UI review found and fixed a system-authored closing-alert event contract mismatch that hid deal details. Full Vitest coverage passes (656 passed, 1 skipped; 85.06% branch coverage), along with typecheck, lint, stylelint, format check, and production build. Authenticated baseline screenshots are captured; final live verification and broader visual review continue under the project UI pass.
- 2026-10-29: PR #36 merged as `6d6647e` after every required CI check passed. It accepts system-authored `closing_soon_alert` events in API/shared schemas, formats alert and legacy assignment activity for people, formats expected-close dates, refines the Board/List segmented control, and removes the global page max-width. CI passed full coverage (656 tests, 1 skipped; 85.06% branches), pgTAP, quality/build, all three image builds/scans, Compose smoke, secret scan, and advisory review. Baseline screenshots remain under `docs/evidence/ui/`; recapture after local Podman and the authenticated seeded browser are restored to verify the latest date format and full assignment feed.
- 2026-10-29: the ongoing project UI pass now uses shared token-backed native controls in deal dashboard/detail and approval-delegation forms. This presentation consistency change leaves stage, assignment, and approval behavior unchanged. The wrapper test, full Vitest (657 passed, 1 skipped), typecheck, lint, stylelint, format, and production build pass. Current-build authenticated visual evidence is still pending.
- 2026-10-30: live mobile review of Asterion's seeded activity feed found raw stage keys and a machine-style `stage change` title. The UI now maps event kinds to reader-facing labels and stage identifiers to the canonical shared labels, with a safe fallback for malformed stage events. Approval quorum reasons receive human copy; other audit reasons remain visible as text. No database or ledger data changed. Targeted tests pass (22); full Vitest passes (660 passed, 1 skipped), along with typecheck, lint, stylelint, format check, and production build. The rebuilt seeded app shows transitions such as “Moved from Due Diligence to IC Review.”
