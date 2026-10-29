# 04 Approvals: progress

Status: in progress (IC gate, absence/reassignment, scoped delegation, and quorum alerts implemented; management UI and custom roles remain)
Owner/branch: codex/feature-04-quorum-alerts
Depends on: 03

## Goal
Approval gates, quorum, decisions, absence, delegation, custom roles and SoD. Covers GOTCHAS row 16.

## Scope
- In (delivered slices): Owner-configured IC k-of-N quorum; submit-time approver snapshot; request/decision/status RPCs; maker-checker enforcement; absence scheduling/cancellation; unavailable-slot reassignment; scoped approval delegation with actor attribution; 2xx API routes; deal-detail controls for quorum, absence, and reassignment; in-app notifications when a pending request can no longer reach quorum.
- Out (follow-up): delegation management UI, custom role editor, SLA escalation, and gates beyond IC review. See ADRs 0018–0021.

## Design notes
ADRs 0018–0020. Configuration uses existing Owner-only `role.manage`; no mutation of immutable system roles. Only approve/reject; requests snapshot the quorum and eligible memberships; rejection fails when quorum is no longer reachable. Delegation is tenant opt-in, time-bound, and substitutes for the delegate's own vote; decisions record both the original slot and acting member. `decide_approval` signs the deal and writes ledger events under the deal lock.

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s) for core IC gate and status
- [x] API
- [x] Web
- [x] Docs updated
- [x] Absence/reassignment follow-up
- [x] Delegation database/API follow-up
- [x] Quorum-unreachable notification follow-up
- [ ] Delegation management UI
- [ ] Custom role editor and notification follow-up

## Tests
`supabase/tests/21_approvals.test.sql` covers request and decision security, quorum, and stage locking; `22_approval_status.test.sql` covers status RPC access. API routes are covered by `apps/api/src/features/approvals/routes.test.ts`; deal-detail controls by `apps/web/src/features/deals/deal-detail.test.tsx`; schemas by `packages/shared/src/deals.test.ts`. Run `make test-db` and targeted Vitest files, then all CI gates.

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

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- Open follow-up: delegation management UI, custom role editing, SLA escalation, and gates beyond IC review. Current unavailable slots can be reassigned when an eligible member exists; otherwise requests remain pending and fail closed. Quorum alerts are hourly and in-app only; no email escalation or repeat reminders are implemented.
