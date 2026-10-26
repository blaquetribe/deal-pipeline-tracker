# ADR 0016: GoTrue admin calls from the auth module only

Status: accepted (owner decision, 2026-10-26). Nothing below is built when this is written; mechanisms are marked **unverified** until their tests exist. Narrows ADR 0015: the service-role key still never reaches the database path.

## Context
Our GoTrue runs with public sign-up disabled (`GOTRUE_DISABLE_SIGNUP=true`, ADR 0014) and we use our own hashed single-use tokens (GOTCHAS 31). Creating a user, setting a password for someone with no session (password reset) and confirming an email therefore need GoTrue's admin API, which accepts only a JWT with `role: service_role`. GoTrue has no narrower role for these calls. The API already holds the JWT secret (ADR 0015 mints the `api_service` JWT with it), so the question is where such a token may be minted and used, not whether the API can.

The owner chose between three options: a short-lived admin JWT confined to the auth module, enabling GoTrue's public sign-up and recover endpoints (and dropping our tokens), or writing `auth.users` from SQL (coupling us to GoTrue's schema).

## Decisions
1. `apps/api/src/auth/gotrue.ts` mints a **30-second** `service_role` JWT per call, for exactly three admin operations: create user, set password, confirm email. The minting function is private to that file; nothing else can obtain the token.
2. **Enforced, not promised:** a test scans `apps/api/src` and fails if the string `service_role` (the role claim) appears outside `apps/api/src/auth/gotrue.ts`, and the existing lint rule keeps Supabase imports under `auth/` and `db/`. Request handlers call the typed `GoTrue` port, never a token.
3. Everything that is not one of those three operations uses the anon key (password login, refresh, logout) or `api_service` through PostgREST (ADR 0015).
4. Sign-up is generic: an existing email gets the same response as a new one (GOTCHAS 18), so the adapter treats GoTrue's "already registered" answer as success without revealing it.

## Consequences
- A bug in the auth module could create users or set passwords. The surface is three functions behind a port, covered by tests with a fake GoTrue, and the token lives 30 seconds.
- Upgrading GoTrue may change the admin endpoints; the adapter has contract tests against the real stack in the compose smoke test.
- The secret that signs these tokens is the shared JWT secret; rotating it (ADR 0014) rotates this too.

## Verified versus open
**Unverified:** GoTrue accepts the minted token for the three calls on this image, the error shape for an existing email, and the exact admin endpoints (`POST /auth/v1/admin/users`, `PUT /auth/v1/admin/users/{id}`). All are checked in the compose smoke test when the adapter exists.
