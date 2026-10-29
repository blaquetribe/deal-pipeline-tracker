# ADR 0021: alert when approval quorum becomes unreachable

## Context

Pending approval requests can become impossible to complete after an approver is absent, deactivated, loses the approval permission, or casts a rejection. The database already fails closed in these cases, but the request creator and tenant administrators otherwise have to discover the problem by opening the deal.

## Decision

- A scheduled database scan creates an in-app notification for the request creator and active Owner/Admin members when a pending request can no longer reach its snapshotted quorum.
- Reachability is calculated from approved slots plus still-pending slots whose approver or active, valid delegate can still decide. Superseded slots and rejected slots do not count.
- Notifications are deduplicated by request and recipient. They link to the deal and do not include deal names or financial data in the notification payload beyond what the recipient can already access on the deal page.
- Alerts are informational. Existing approval functions remain authoritative and continue to block signing when quorum is unreachable. No email escalation or repeated reminders are introduced.

## Consequences

The scan uses the existing tenant-scoped notification table and same-origin realtime delivery. Delivery is hourly, so an alert may be delayed by up to an hour. Alerts are immutable notification records with the existing read marker behavior; a repaired request does not erase its history.
