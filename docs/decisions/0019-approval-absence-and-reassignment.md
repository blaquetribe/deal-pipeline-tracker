# ADR 0019: approval absences and reassignment

Status: accepted
Date: 2026-10-29

## Context

The first IC gate snapshots approvers at request time. An approver can become unavailable through a planned absence, membership deactivation, or permission revocation while a request is pending. Leaving that slot counted as reachable can make the quorum appear achievable when it is not; deleting the slot would erase the original decision snapshot.

## Decision

- An approver may schedule and cancel only their own tenant-scoped absence. Windows must have a positive duration, may last at most 365 days, and may not overlap another uncancelled window for that membership. Absence changes are appended to the tenant audit trail.
- An active absence removes the membership from a new request's eligible snapshot and prevents it from deciding on an existing request. Pending quorum reachability excludes absent, deactivated, or permission-revoked snapshot members.
- An Owner or Admin with `member.manage` may replace an unavailable, undecided slot with an active member who currently has `approval.decide`, is not the requester, does not have `deal.request_approval`, is not absent, and has no existing slot on that request.
- Reassignment creates a new slot and marks the original slot as superseded with actor and time metadata. It never deletes or overwrites the original snapshot. The deal event is appended to the existing hash-chained ledger.
- Decision writes lock the deal, request, and acting membership. Absence scheduling locks the member row, so a decision and an absence have a clear database ordering.
- Delegation, notification/escalation when a quorum becomes unreachable, and custom-role editing remain follow-up work. Until then, an unreachable request stays fail-closed and cannot advance the deal.

## Consequences

The API never accepts a tenant id, acting membership, actor, or audit timestamp from the browser. Postgres owns the absence and replacement rules; the API validates shape and the UI is only a convenience. Replacements are limited to members outside the request's snapshot, preserving one decision slot per member per request.

The absence controls and reassignment choices are surfaced in the deal approval panel. A tenant-wide availability settings page may be considered during the planned UI pass.

## Verification

pgTAP covers forced RLS, direct-write denial, function grants, cross-tenant denial, absence decision blocking, quorum reachability, replacement eligibility, snapshot preservation, and audit events. Vitest covers route auth/validation, shared contracts, and the deal-detail controls. CI must pass the database suite before merge.
