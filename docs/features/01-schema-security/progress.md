# 01 Schema and security: progress

Status: done (schema and database security shipped; function exposure is tested in both `public` and `app`)
Owner/branch: main
Depends on: 00

## Goal
Tenancy, RBAC tables, deals, immutable notes, RLS, SQL tests. Covers GOTCHAS rows 2, 3, 4, 15.

## Scope
- In (slice 1): `tenants`, `memberships`, `deals`, `deal_events` (hash-chained ledger), forced RLS, no direct write grants, `post_event`, `verify_ledger`, function-grant allowlist test.
- Slice 2 (done): `permissions` catalogue and `permission_conflicts` (global reference data, no `tenant_id`, by design), per-tenant `roles`, `role_permissions`, `membership_roles`, `app.has_permission`, static SoD triggers, immutable system roles, six system roles via `app.seed_system_roles`; reads of deals and the ledger need `deal.view`, `post_event` needs `deal.note`.
- Slice 3 (done): deal fields (`sector`, `amount` bigint minor units, `currency` default ZAR, `expected_close_date`, optional `expected_close_time`), `stage_transitions` and `stage_requirements` as data, `create_deal` (needs `deal.create`), `move_stage` (needs `deal.edit`, row lock, `version` check, transition check, required fields, ledger event). Errors: `DP409` stale version, `DP422` rule violation, `42501`, `P0002`, `55000`. `ic_review -> signed` is deliberately not a legal move: it arrives with the approval decision (feature 04), so until then nobody can reach `signed`.
- Slice 4 (done): `create_tenant` (verified email required, seeds roles, creator becomes Owner), `grant_role` / `revoke_role` / `deactivate_member` (need `member.manage`; no self-change; privileged roles, those holding `member.manage` or `role.manage`, only by someone with `role.manage`), `transfer_ownership`, the append-only `tenant_events` trail, a last-owner invariant (triggers, binds every role), `update_deal` (allow-listed fields, amounts as integer strings, version check, cannot strip a field the current stage requires, ledger event with old and new values). Parity (E1): `packages/shared/fixtures/stage-machine.json` is run through the TS mirror (`stage-machine.ts`, vitest) and through the real `move_stage` in `07_stage_parity.test.sql` (the db container mounts `/fixtures`).
- Completed by dependent features: deal assignees and filtered assignment reads (03); once-per-user tenant creation through onboarding (02); approvals (04).
- Out (and where it goes): approvals and quorum (04), auth flows and invitations (02), seed data (06).

## Design notes
Key decisions, schema/API shape, links to ADRs.

## Tasks
- [x] Failing tests written for slice 1: `supabase/tests/01_tenancy_rls.test.sql` (21), `02_ledger_immutability.test.sql` (24)
- [x] Migration, slice 1: `supabase/migrations/20261027000000_tenancy_and_ledger.sql`
- [x] API and Web consumers delivered through features 02 and 03; authorization remains in database functions and RLS.
- [x] Feature and project documentation updated as dependent slices landed.

## Tests
`make test-db` runs the full pgTAP suite from a clean database. Tests set `request.jwt.claims`, which `app.uid()` reads (GOTCHAS 98). Per-role and cross-tenant checks live in `03_rbac.test.sql` and later feature tests; PostgREST role switching was verified in the Feature 02 compose smoke. The function exposure check now covers both `public` and `app` schemas. Recorded sabotage runs cover the stage machine, role separation, and last-owner protections. Automated two-session contention coverage for concurrent `move_stage` calls remains a limitation; row locking, optimistic versions, and stale-write rejection are covered by implementation and single-session tests.

Contract the tests fix (names and behaviour the migration must satisfy): `deals.archived_at`, `deals.stage` with a default, `deal_events(id, tenant_id, deal_id, kind, body, actor_id, actor_email, created_at, prev_hash, hash)`; composite FK `(tenant_id, deal_id)`; RESTRICT parents; trigger message `deal_events is append-only` (P0001); `post_event(uuid, text, text)` raising P0002 `deal not found` for non-members; `verify_ledger(uuid) returns boolean`.

## Security checklist (from SECURITY_STANDARDS.md)
- [x] Core business tables use forced RLS, tenant-scoped policies, composite tenant relationships, and role/cross-tenant tests.
- [x] Database functions are the write boundary; privilege tests cover `public` and `app` exposure, and direct writes to core tables are revoked.
- [x] Stage rules, permissions, tenant administration, ownership transfer, and immutable audit behavior are enforced in Postgres and covered by pgTAP.
- [x] Dependent API routes validate inputs and derive tenant/actor context from authenticated sessions; signed-out and permission tests are maintained with features 02–04.
- [x] The web app has no Supabase client; the API is the only Supabase boundary.

## Log
- 2026-10-26: slice 1 tests written and run red (14 passed from file 00, 9 failed, files 01 and 02 abort at the first fixture insert).
- 2026-10-26: **correction to slice 4.** GOTCHAS 100 as first written was wrong. `make test-db` ran against the bare database image, where `auth.users` lacks GoTrue's later columns; on the real stack `email_confirmed_at` exists and `confirmed_at` is generated (`LEAST(email_confirmed_at, phone_confirmed_at)`). The tests inserted `confirmed_at` (would fail in the full-stack smoke run) and `create_tenant` checked `confirmed_at` (would accept a phone-only confirmation). Fixed: migration `20261031000000_create_tenant_email_verified.sql`, fixtures use `email_confirmed_at`, a phone-only test, and `make test-db` now starts `auth` first. Suite 194 assertions green; `make smoke` 54 checks pass, one fails only because an unrelated host process listens on port 3001.
- 2026-10-26: slice 4. Tests written first and run red (05 and 06 failed on the missing functions, the TS test on the missing module; 07 passed at once because the existing tables already matched the fixture). Then migration `20261030000000_tenant_admin_and_update_deal.sql`: SQL suite green, 193 assertions; vitest 247 passing, shared coverage 100%; typecheck, lint, format clean. Sabotage runs (open `ic_review -> signed`; drop the last-owner triggers; make `role_is_privileged` always false) each failed the intended tests (1, 6 and 12 respectively). Found GOTCHAS 100 (`confirmed_at`). `make smoke` was not rerun after the compose mount change.
- 2026-10-26: slice 3 tests (`04_stage_machine.test.sql`, 33) and migration `20261029000000_stage_machine.sql`; suite green, 124 assertions. Honest note: the migration was written after the tests but the tests were not run red first this time. Sabotage runs (open `ic_review -> signed`, empty `stage_requirements`, drop the version check) each failed the intended test; a transitions sabotage aborted the file at the fixture step. Concurrent moves are not tested (needs two sessions); the row lock is by inspection only.
- 2026-10-26: slice 2 (RBAC) tests written first (`03_rbac.test.sql`, 35), migration `20261028000000_rbac.sql`; suite green, 91 assertions. Sabotage run (SoD and system-role triggers dropped) failed exactly the 7 intended tests. Slice 1 fixtures now assign an observer role because reads are default deny.
- 2026-10-26: slice 1 migration written; all green. Found that `auth.uid()` returns null under our PostgREST settings; added `app.uid()` (GOTCHAS 98). Owner roles bypass RLS in this image (GOTCHAS 99), so the ledger relies on privileges plus triggers. Owner roles bypass RLS in this image (GOTCHAS 99), so the ledger's protection is privileges plus triggers.
- 2026-10-29: final review found the broad function-exposure assertion covered `public` but not helper functions in `app`. Added an explicit pgTAP assertion for `app` in PR #18. Full GitHub CI, including pgTAP, passed; PR #18 merged to `main` as `68e0718`.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- Concurrent stage-move contention is not exercised with two simultaneous database sessions. The row lock and optimistic version checks are present; a dedicated two-session test remains useful follow-up coverage.
