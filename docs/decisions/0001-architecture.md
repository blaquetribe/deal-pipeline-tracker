# ADR 0001: Architecture and locked decisions

Status: accepted (planning session). Later ADRs supersede, never edit this one.

## Decisions
- **Monorepo (pnpm workspaces):** `apps/web` (Next.js, TS, UI only), `apps/api` (Hono, separate service), `packages/shared` (zod contracts and inferred types), `supabase/` (migrations, seed).
- **Web knows nothing about Supabase.** No SDK, keys, or URL. Talks to the API only (through a Next route-handler proxy so the browser sees one origin).
- **API is the only Supabase client.** Per-request client carrying the user's JWT so RLS applies. Service-role key only for migrations/seed/admin jobs, never in request handlers.
- **Sessions:** httpOnly, SameSite cookie issued by the API. Tokens never reach browser JS.
- **State (web):** TanStack Query for server state, URL params for filters, local state for forms. Zustand only if a real need appears.
- **Migrations:** Supabase CLI SQL files in `supabase/migrations`, one-shot `migrate` service in compose, CI applies from scratch.
- **Realtime:** Hono WebSocket (`/ws`), one tenant per connection, per-user Supabase Realtime subscription so RLS filters events, plus explicit tenant filter. Client applies events to the query cache; refetch on reconnect.
- **Multi-tenancy:** `tenant_id` on every business table; users can belong to many tenants (memberships carry roles); tenant switcher in UI.
- **Onboarding:** public sign-up; email verification creates the tenant and the Owner. Users do not create extra tenants from the switcher; only the Owner can create custom roles within their tenant. Invitations bring other users in. Own hashed single-use tokens; `Mailer` interface over SMTP; Mailpit locally.
- **RBAC:** permission-based. System roles immutable (Owner, Admin, Deal Team Member, Deal Lead, IC Member, Observer/Compliance). Custom roles by Owner only, gated by static separation-of-duties checks.
- **Approvals:** maker-checker gates, configurable k-of-N quorum. A rejection counts against the quorum (fails once approvals plus remaining pending cannot reach k). Decisions append-only. Requester cannot approve. Admin is not an approver.
- **Absence:** absence status removes user from eligible pool; delegation allowed but off by default for IC gates; SLA escalation is notification only; Owner/Admin may reassign (not approve); alert Owner if pool < quorum. Never fail open.

## Consequences
Larger than the 6-10h guidance. Core vs cut list lives in `docs/PROGRESS.md`.
