# ADR 0020: scoped approval delegation

Status: accepted
Date: 2026-10-29

## Context

The approval gate snapshots eligible memberships. A temporarily unavailable IC member may need another eligible member to act on their slot. Delegation must preserve that snapshot, remain off unless a tenant Owner enables it, and must not allow self-approval or let one person provide multiple votes for one request.

## Decision

- Delegation is disabled by default per tenant. An Owner may enable or disable it through approval policy configuration. The setting cannot change while the tenant has pending approval requests.
- An active approver may schedule a time-bounded delegation to another active member who currently has `approval.decide` and no conflicting permissions. The delegator and delegate cannot have overlapping delegation relationships, and a delegate can cover at most one member during a time window.
- A delegation is configured by the delegator, not by an Owner on their behalf. The delegate may revoke it. Scheduling is blocked while any approval request in the tenant is pending, so request snapshots never gain or lose proxy relationships after creation. Revocation is immediate and audited.
- New requests preserve the delegator's original approver slot and omit the active delegate's own slot. A delegate can cast one vote for that preserved slot. If the delegate is also the request maker, that delegator slot is omitted and quorum eligibility is checked before the request is accepted.
- Decision rows record both the snapshotted membership and the acting membership. A partial unique index enforces one vote per acting membership per request. The deal ledger identifies proxy decisions; delegation create/revoke events go to the tenant audit trail.
- The API exposes delegation choices, own delegation records, create/revoke operations, and delegated slots in approval status. A management UI remains cut-list scope. Notification recipients for delegates remain a Feature 05 follow-up.

## Consequences

Delegation is a replacement for the delegate's own vote on each request where they are acting as proxy; it does not increase quorum weight. The UI cannot enable or manage it in this slice, so it remains off until an authorized API client configures the tenant and a member schedules a delegation. Existing pending requests are stable because relationship changes and policy toggles are constrained while they are open.

## Verification

pgTAP covers opt-in default, role and tenant boundaries, immutable snapshots, proxy decision attribution, duplicate-vote prevention, and audit events. Vitest covers API authentication, strict input validation, and caller-JWT RPCs. CI must pass pgTAP, Compose smoke, and all quality/image checks before merge.
