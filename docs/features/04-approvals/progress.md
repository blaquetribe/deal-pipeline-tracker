# 04 Approvals: progress

Status: in progress
Owner/branch: feat/04-approvals
Depends on: 03

## Goal
Approval gates, quorum, decisions, absence, delegation, custom roles and SoD. Covers GOTCHAS row 16.

## Scope
- In (first slice): Owner-configured IC k-of-N quorum; submit-time approver snapshot; request/decision/status RPCs; maker-checker enforcement; 2xx API routes; deal-detail controls.
- Out (follow-up): absence/reassignment and delegation actions, custom role editor, notifications/SLA escalation, and gates beyond IC review. Delegation UI remains on the cut list. See ADR 0017.

## Design notes
ADR 0017. Configuration uses existing Owner-only `role.manage`; no mutation of immutable system roles. Only approve/reject; requests snapshot the quorum and eligible memberships; rejection fails when quorum is no longer reachable. `decide_approval` signs the deal and writes ledger events under the deal lock.

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s) for core IC gate and status
- [x] API
- [x] Web
- [x] Docs updated
- [ ] Absence/reassignment and delegation follow-up
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
- 2026-10-28: implemented the core IC approval gate in migrations 15–17, API, and deal detail UI. Existing system roles could not accept a new permission, so configuration correctly uses their existing `role.manage` permission (ADR 0017). The quorum has a 1–50 database bound in addition to API validation. Full Vitest (460 tests) and pgTAP (450 assertions) pass. Lint, typecheck, stylelint, format and build pass; coverage remains below threshold on the unmerged `main` baseline.
- 2026-10-28: captured the running dashboard/detail UI in the browser after rebuilding the local web/API containers. The approval controls are covered in component tests; no persistent deal was moved just to create an IC-review screenshot because stage changes are audited and append-only.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- Open risk: role revocation/deactivation after a request is snapshotted can leave an approver pending. Absence/reassignment handling is required before the broader Feature 04 scope is complete.
