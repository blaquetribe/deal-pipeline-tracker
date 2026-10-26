# AI Usage Log

Running log feeding the README reflection required by the brief. Add an entry per feature or notable session.

## Entry template
- **Date / feature:**
- **What Claude did:**
- **What the human decided or corrected:**
- **How it was verified (tests, review, manual):**
- **What went wrong or was surprising:**

## Entries
### 2026-10-26 / planning
- **What Claude did:** read the brief, produced a requirements report, proposed architecture, tenancy, onboarding, RBAC and approval designs, and the gotcha analysis (`docs/brief/GOTCHAS.md`); scaffolded docs and standards.
- **What the human decided or corrected:** chose Next.js + Hono + Supabase SDK with a separate API boundary and a UI with no Supabase knowledge; required realtime and multi-tenancy; corrected Claude's invite-only suggestion to open sign-up with an Owner; pushed for best-practice financial roles, approvals and absence handling; set quorum, delegation and rejection rules.
- **How it was verified:** n/a (design only).
- **Surprises:** several of the human's requirements go well beyond the brief's scope; a cut list was agreed to manage that.
