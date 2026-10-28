# ADR 0018: first approval gate slice

Status: accepted
Date: 2026-10-28

## Context

Feature 04 follows the database-first security model. Existing RBAC already prevents one membership from combining `deal.request_approval` with `approval.decide`, and prevents Owners/Admins who manage people or roles from deciding approvals. The stage machine intentionally has no ordinary `ic_review -> signed` transition.

## Decision

- The first gate applies to `ic_review` and uses a tenant-configured positive k-of-N quorum. An Owner configures it through the existing `role.manage` permission; no new permission is added to immutable system roles.
- A request snapshots the active tenant memberships holding `approval.decide`, excluding the requester, and snapshots the configured quorum. Later policy edits do not change an open request.
- Only `approve` and `reject` are decisions. There is no abstention; absence and delegation need explicit future actions. Rejection counts against quorum, and a request fails only when approvals plus still-pending eligible approvers cannot reach k.
- The database locks the deal during request and decision writes. Reaching quorum marks the request approved, advances the deal to `signed`, increments its version, and writes the stage event in the same transaction. An open request prevents an ordinary stage move.
- Each request and decision is recorded in the existing append-only `deal_events` hash chain. Reads and writes stay tenant scoped and use the caller's JWT through the API.

## Scope and follow-up

This slice implements IC gate configuration, request, decision, status, and the corresponding deal-detail controls. It does not implement absence/reassignment, delegation, custom role editing, notifications, or gates at other stages. Those remain Feature 04 follow-up work; until then, a deactivated or permission-revoked approver can leave a request pending and the gate fails closed.

## Verification

pgTAP covers role and tenant denial, stale versions, requester exclusion, duplicate decisions, rejection reachability, pending-stage protection, ledger events, and atomic signing. Vitest covers API authentication/validation and accessible UI request behavior. Full CI is still required before merge.
