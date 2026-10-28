# Deal Pipeline Tracker

Work in progress. Full README (run instructions, architecture, trade-offs, next steps, AI usage reflection) is written in feature 06. See `docs/` for current status.

## What I'd do next

- Complete Feature 04 absence/reassignment and scoped delegation before claiming the approval workflow is complete; then add the custom role editor and SLA notifications if time allows. Until absence handling ships, a deactivated or permission-revoked approver can leave a request pending, which intentionally blocks signing.
- For Feature 05, add alert preference controls and absence/delegation-aware recipients; decide how to handle the rare duplicate email after a successful SMTP send with failed outbox completion. Presence remains on the cut list.
