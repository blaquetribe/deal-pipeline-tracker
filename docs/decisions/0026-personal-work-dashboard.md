# ADR 0026: signed-in user's work dashboard

Status: accepted (owner request, 2026-10-31)

## Context

The original landing page showed only an organisation-wide deal pipeline. Users had no one place to see their assignments, their pending IC decisions, or alerts addressed to them. The brief requires an at-a-glance pipeline; the owner clarified that the product also needs a proper user-context dashboard and visible deal progress.

## Decision

- The signed-in user's landing page is **My Work**. The organisation-wide pipeline remains available at `/pipeline`.
- The dashboard combines the caller's active assigned deals, IC approval requests for which the caller can still decide, and that caller's recent notifications.
- The assignment list is produced in Postgres by a caller-JWT, tenant-scoped RPC. It filters by `app.uid()` and `deal.view`; the browser does not download all tenant deals and infer a personal list. Assignment remains responsibility metadata, never an access-control rule (GOTCHAS 35).
- Deal progress follows the canonical non-outcome stage order Sourcing → Screening → Due Diligence → IC Review → Signed → Closed. **Passed** is displayed as a terminal outcome, not as progress toward Closed; **Closed** is the completed end of the stage track (GOTCHAS 8).
- The decision list uses the existing approval status contract. It does not submit or decide requests; the deal page and Postgres approval functions remain authoritative.
- The dashboard is a read surface. It does not write deal events or mark notifications read merely by loading.

## Consequences

The home page is personalized while reviewers still get the full pipeline at a direct, named route. A new additive database function and pgTAP tests protect identity, tenant, permission, and stage-outcome behavior. Team member administration is described separately in ADR 0027.
