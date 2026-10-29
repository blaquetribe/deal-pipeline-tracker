# ADR 0024: IC approval SLA escalation

Status: accepted
Date: 2026-10-29

## Context

Feature 04 already has a database-enforced IC approval gate, tenant-configured quorum, absence and delegation rules, and an hourly alert when an open request can no longer reach quorum. A request can still remain valid and pending without attracting attention for a long time. The original architecture calls for notification-only escalation, but did not set a duration or define its audience.

## Decision

- Keep approvals scoped to the existing `ic_review` gate. Do not add approval gates at other pipeline stages.
- After an IC approval request has remained pending for 24 hours, the existing notification system creates one in-app escalation per recipient. The scan runs hourly, so delivery may be delayed by up to an hour.
- Notify active, undecided approvers who still have `approval.decide`, including a valid active delegate; also notify the requester and active tenant Owners/Admins. Skip deactivated members, unavailable direct approvers, archived deals, and completed requests.
- Keep the escalation informational. It does not change quorum, make a decision, reassign an approver, or move the deal. Do not send email or repeat the alert in this slice.
- Use a fixed 24-hour threshold and a request-recipient dedupe key. Revisit configurability only if operating feedback calls for it.
- Keep notification data tenant-scoped and limited to the deal name, the overdue message, and a same-origin deal link.

## Consequences

The SLA is predictable without adding another tenant configuration control. Notification delivery is eventually consistent with the hourly scan. A recipient can see the same overdue request once, even when multiple workers scan it. Quorum and signing remain governed by the existing database functions.

## Verification

pgTAP covers the 24-hour boundary, recipient set, tenant-scoped records, deduplication, scheduler registration, and inaccessible scanner function. Shared schema and notification UI tests cover validation and human-readable rendering.
