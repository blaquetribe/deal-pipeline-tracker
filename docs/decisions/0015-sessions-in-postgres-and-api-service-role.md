# ADR 0015: Sessions in Postgres and a narrow `api_service` role

Status: accepted (owner decision, 2026-10-26, at the start of feature 02). Nothing below is built yet; every mechanism is marked **unverified** until its test exists. Refines ADR 0002 decision 3 (server-side sessions) and the SECURITY_STANDARDS rule that the service-role key is not used by request handlers.

## Context
ADR 0002 says sessions are server-side: the browser holds an opaque cookie, the API holds the Supabase tokens and refreshes them single-flight. It does not say where they are kept. Separately, some flows have no user JWT (verify-email token, invitation landing, sign-up bookkeeping, session lookup itself), and the standard says the service-role key exists only for migrations, seed and admin jobs, so request handlers cannot simply use it.

The owner chose between three session stores (Postgres table, in-memory in the API, a separate Redis) and between two ways to do JWT-less privileged work (a narrow role, or the service-role key inside the auth module).

## Decisions
1. **Sessions live in a Postgres table** (`api_sessions`): an opaque session id (only its hash stored), the user id, the Supabase tokens, expiry and revocation. Refresh tokens are encrypted by the API before they are stored, with a key from configuration. The table is reachable only by the role in decision 2, never by `authenticated`, `anon` or `service_role`, and is revoked from PUBLIC.
2. **A dedicated `api_service` Postgres role** does JWT-less work. The API reaches it through PostgREST with a short-lived JWT whose `role` claim is `api_service`, signed with the existing JWT secret. The role has `EXECUTE` on a short list of `SECURITY DEFINER` functions (session create, lookup, refresh, revoke; token consume; invitation lookup) and no table privileges. Request handlers never use the service-role key.
3. Everything stays under `apps/api/src/auth/` (the only place that may import Supabase Auth, GOTCHAS 5); the JWT for `api_service` is minted there too.

## Consequences
- Sessions survive an API restart, can be revoked for a user or a tenant, and can drive closing WebSockets (ADR 0002, feature 05). More than one API instance would work.
- A new encryption key joins the secrets (`.env.example` placeholder only; dev-only default like the others, ADR 0014). Rotating it invalidates stored sessions; that is acceptable.
- The privileged surface is a reviewable list of functions rather than a key. Each function needs the same grant tests as the rest (revoked from PUBLIC, explicit grant to `api_service` only, pinned `search_path`), and the existing "no function executable by PUBLIC or anon" test must keep passing.
- `api_service` must be allowed to be set by PostgREST's `authenticator`; the `rest` configuration may need the role added to the grants. Sign-in latency gains one database round trip per request for session lookup.
- Failing closed: no session row, expired, revoked, or undecryptable token means signed out.

## Verified versus open
Verified: the roles `authenticator`, `anon`, `authenticated` and `service_role` exist in the image and the existing function-grant tests pass (feature 01); the standard's wording on the service-role key (`SECURITY_STANDARDS.md`, Principles 3). **Unverified:** that PostgREST switches to a custom role named in the JWT in this stack, that `app.uid()` works through PostgREST (GOTCHAS 98), the encryption scheme, and the session functions themselves. Revisit if sessions need to be shared across regions (a dedicated store would then be reconsidered).
