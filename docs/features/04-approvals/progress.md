# 04 Approvals: progress

Status: in progress (IC gate, absence/reassignment, scoped delegation, quorum alerts, personal delegation controls, custom role editor, and 24-hour IC SLA escalation implemented; gates beyond IC are outside the approved scope)
Owner/branch: codex/feature-04-ic-sla-escalation
Depends on: 03

## Goal
Approval gates, quorum, decisions, absence, delegation, custom roles and SoD. Covers GOTCHAS row 16.

## Scope
- In (delivered slices): Owner-configured IC k-of-N quorum; submit-time approver snapshot; request/decision/status RPCs; maker-checker enforcement; absence scheduling/cancellation; unavailable-slot reassignment; scoped approval delegation with actor attribution; 2xx API routes; deal-detail controls for quorum, absence, reassignment, and personal delegation; in-app notifications when a pending request can no longer reach quorum; tenant role catalog and audited custom role create/edit UI.
- Out (owner decision): approval gates beyond IC review. See ADRs 0018–0024.

## Design notes
ADRs 0018–0024. Configuration uses existing Owner-only `role.manage`; system roles remain immutable. Custom role writes use a caller-authorized database function, validate permission catalog membership and SoD for both the role and current holders, and append a tenant audit event. Only approve/reject; requests snapshot the quorum and eligible memberships; rejection fails when quorum is no longer reachable. Delegation is tenant opt-in, time-bound, and substitutes for the delegate's own vote; decisions record both the original slot and acting member. `decide_approval` signs the deal and writes ledger events under the deal lock. A 24-hour pending IC request triggers one idempotent in-app escalation to eligible pending approvers, the requester, and active tenant Owners/Admins; it never changes approval state.

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s) for core IC gate and status
- [x] API
- [x] Web
- [x] Docs updated
- [x] Absence/reassignment follow-up
- [x] Delegation database/API follow-up
- [x] Quorum-unreachable notification follow-up
- [x] Delegation management UI and Owner policy toggle
- [x] Custom role editor
- [x] Notification-only SLA escalation for the existing IC gate
- [x] Record the owner's decision to keep approvals scoped to IC review

## Tests
`supabase/tests/21_approvals.test.sql` covers request and decision security, quorum, and stage locking; `27_approval_delegation.test.sql` covers delegation and SLA escalation; `22_approval_status.test.sql` covers status RPC access; `28_custom_roles.test.sql` covers catalog access, role writes, tenant isolation, SoD, immutable system roles, and audit events. Approval routes are covered by `apps/api/src/features/approvals/routes.test.ts` and `apps/api/src/features/roles/routes.test.ts`; role UI by `apps/web/src/features/roles/role-management.test.tsx`; notification UI and schema by their feature tests. Run `make test-db` and targeted Vitest files, then all CI gates.

## Security checklist (from SECURITY_STANDARDS.md)
- [x] New tables have `tenant_id`, RLS enabled and forced, policies, tests for key roles and cross-tenant.
- [x] New routes declare auth and permission; signed-out test passes.
- [x] No client-supplied tenant/author/role/timestamp is trusted.
- [x] Approval decisions and stage changes are append-only ledger events; direct writes are revoked.
- [x] Inputs validated by zod; database errors map through the existing API error layer.
- [x] No secrets, tokens, or PII in logs.
- [x] Web still has no Supabase dependency.

## Log
Dated notes: what changed, what was learned, problems.
- 2026-10-28: implemented the core IC approval gate in migrations 15–17, API, and deal detail UI. Existing system roles could not accept a new permission, so configuration correctly uses their existing `role.manage` permission (ADR 0018). The quorum has a 1–50 database bound in addition to API validation. PR #14 merged to main as `e1fd24c` after all required CI checks passed; the combined run passed 520 Vitest tests, pgTAP, typecheck, lint, stylelint, format, build, image scans, and compose smoke. Absence/reassignment and delegation remain extended follow-up.
- 2026-10-29: added migration 26 for self-managed absence windows and Owner/Admin replacement of unavailable approval slots. Reassignment preserves and supersedes the original slot and is recorded in the deal hash chain; absence changes are recorded in the tenant trail. API routes and deal-detail controls use caller JWTs and strict shared schemas. See ADR 0019. Typecheck, lint, stylelint, format, build, and 597 Vitest tests (1 skipped) pass. Local pgTAP could not start because the Podman-backed Docker API stalled before creating containers; CI must run migration 26 and test 26 before merge.
- 2026-10-29: first CI run exposed a fixture bug in test 26: authenticated owner queries for other members' membership IDs were hidden by RLS, so the reassignment call received null IDs. The test now captures fixture IDs before switching roles. PR #19 head `5d13633` passed every required CI check on run `40864349477`, including pgTAP and clean-clone Compose smoke.
- 2026-10-28: captured the running dashboard/detail UI in the browser after rebuilding the local web/API containers. The approval controls are covered in component tests; no persistent deal was moved just to create an IC-review screenshot because stage changes are audited and append-only.
- 2026-10-29: started scoped delegation on clean main after PR #19 merged. ADR 0020 and migration 27 add tenant opt-in, bounded self-scheduling and revocation, immutable original approver slots, acting-member attribution, one-vote enforcement, delegated status, and caller-JWT API operations. The management UI remains cut-list scope. `pnpm test:coverage` passes all 601 tests with 1 skipped and thresholds met; typecheck, lint, stylelint, format check, and build also pass. `make test-db` is blocked by Podman socket permissions. PR #20 head `329b9a6` passed all required GitHub checks on run `40870860435`, including pgTAP and clean-clone Compose smoke. Its first CI attempt found the duplicate-decision error order; commit `329b9a6` corrected it without changing the established error contract.
- 2026-10-29: added ADR 0021 and migration 28 for an hourly, idempotent in-app alert when a pending request's snapshotted quorum is unreachable. Eligibility includes valid active delegates and excludes unavailable, conflicting, or already-voted actors. Alerts go to the requester and active tenant Owners/Admins; the existing approval function remains authoritative. Shared schema and notification UI handle both alert kinds. Targeted UI/shared tests, typecheck, lint, stylelint, formatting, full Vitest coverage (603 passed, 1 skipped), and build pass. Local `make test-db` is blocked by a Podman API EOF; GitHub CI must verify migration and pgTAP before merge.
- 2026-10-29: PR #21 merged as `a659d8e` after all required checks passed, including migration 28 pgTAP, image scans/builds, and Compose smoke. The current personal delegation UI branch adds migration 29 for an Owner-authorized policy read, an Owner control to enable/disable delegation, and approver schedule/revoke controls. Targeted approval route, shared schema, deal detail, and delegation panel tests pass. Full typecheck, lint, stylelint, formatting, coverage (608 passed, 1 skipped; 85.14% branches), and production build pass. Local pgTAP startup is blocked by Podman EOF; GitHub CI is required before merge. Current-build screenshot is pending because available app tabs are stale or signed out.
- 2026-10-29: PR #22 was merged by the owner and local `main` was updated to `aba1073`. On `codex/feature-04-custom-roles`, added ADR 0022, migration 30 and pgTAP test 28, shared role contracts, caller-JWT catalog/save routes, a protected `/roles` editor, and invitation role choices from the tenant catalog. Focused Vitest (39 tests across five files), full coverage (634 passed, 1 skipped; 85.1% branches), typecheck, lint, stylelint, and build pass. Local formatting is being rechecked. `make test-db` remains blocked by Podman API EOF, so CI must verify the migration and pgTAP before merge.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- Out of agreed scope: approval gates beyond IC review. Current unavailable slots can be reassigned when an eligible member exists; otherwise requests remain pending and fail closed. Quorum alerts are hourly and in-app only. SLA alerts are one-time and in-app after 24 hours; no email escalation or repeat reminders are implemented.
- 2026-10-29: the owner chose to keep approvals on the IC gate and add SLA escalation there only. ADR 0024 records a 24-hour pending threshold, hourly scan, one-time recipient dedupe, and notification-only behavior. Migration 31 adds a scheduler-owned scanner that notifies active undecided approvers (including valid delegates), the requester, and active Owners/Admins. Shared notification validation and distinct notification-bell wording are covered. Local `test-db` passes 605 pgTAP assertions across 30 files; focused shared and UI tests pass (9). Full Vitest and coverage pass (648 passed, 1 skipped; 85.04% branches), as do typecheck, lint, stylelint, format, build, and `make env-check`. PR CI remains before merge.
