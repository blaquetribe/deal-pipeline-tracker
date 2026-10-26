# ADR 0002: Gateway, DB-enforced rules, ledger, sessions

Status: accepted. Supersedes parts of ADR 0001 (noted below). Full reasoning and trade-offs: `docs/PRESENTATION_NOTES.md`.

## Supersedes in ADR 0001
- "Through a Next route-handler proxy" -> replaced by a **gateway** container (Caddy or nginx) giving one origin: `/` -> web, `/api` and `/ws` -> api.
- Per-table append-only audit data -> replaced by a single **`deal_events` ledger**.

## Decisions
1. Only the gateway publishes a port. Supabase (Postgres, Auth, Realtime, Mailpit) is internal; Studio and PostgREST are never reachable from the host.
2. Business rules (stage machine, required fields per stage, quorum, SoD) live in database functions. `authenticated` has no direct write grants on core tables; writes go through functions called by the API as the user.
3. Server-side sessions: opaque httpOnly cookie, tokens held by the API, single-flight refresh per session, WebSocket tied to the session.
4. One append-only `deal_events` ledger (notes, decisions, stage and field changes, approval decisions), DB-set actor and time, actor name/email snapshot, optional `amends_event_id`, per-deal hash chain with `verify_ledger`.
5. Users are deactivated, never hard-deleted. User directory is tenant-scoped.
6. CI runs against real Supabase Postgres; all functions revoked from PUBLIC with explicit grants; policies use `(select auth.uid())`.
7. Optimistic concurrency (`version`) on deals; row locks in approval decisions.
8. Realtime via `postgres_changes` with user JWT plus tenant filter; broadcast-from-database recorded as the scale path.
9. Verification and invitations use our own hashed single-use tokens; users created with `email_confirm: false` until consumed.
10. Stage-gated required fields enforced in `move_stage`.
11. Dashboard totals per currency; seed dates relative to now; CD = build and push images only.
12. Tenant-level visibility only; per-deal barriers are documented as out of scope.

## To verify by spike before relying on them
- Supabase Realtime `postgres_changes` behaviour with per-user JWTs from a server process.
- Patched Next.js version for the middleware advisory.
- Gateway WebSocket pass-through with cookie auth and Origin check.
