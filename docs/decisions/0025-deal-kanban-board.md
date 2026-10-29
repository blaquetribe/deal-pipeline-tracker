# ADR 0025: Deal Board view with accessible List alternative

Status: accepted

## Decision

Add Board view to the deals page with one column for each pipeline stage. Cards can be dragged only to transitions already allowed by the shared stage machine and only when the deal has the fields required by the destination. Successful drops call the existing versioned stage API; Postgres remains authoritative. Keep List view and its keyboard-accessible “Move to…” control.

The board uses the same server-side filters and pagination as List view, and therefore displays the current page of deals. Motion feedback uses short transform/opacity and color transitions and disables transitions for reduced-motion users. No drag-and-drop dependency or database change is needed.

## Rationale

The owner requested a visible, draggable pipeline. ADR 0009 requires accessible equivalents for visual patterns, and the markup standard treats drag-and-drop as an enhancement. Reusing the existing stage machine and API avoids a second rules implementation and preserves optimistic version checks.

## Consequences

- Users can see pipeline stages at a glance and move valid deals by dragging.
- Keyboard users retain stage movement in List view.
- The board is page-bounded; users navigate pages using the existing pagination controls.
- Browser-level drag behavior and visual performance still require a current-build UI review.
