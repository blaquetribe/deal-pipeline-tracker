# Security Standards

Financial deal data, multi-tenant. Fail closed. Every rule below needs a test or a documented reason.

## Principles
1. **Authorization lives in the database.** RLS is the enforcement; API guards are defence in depth; UI hiding is cosmetic.
2. **Default deny.** New tables, routes, WebSocket messages and functions are inaccessible until explicitly allowed.
3. **Least privilege.** Request handlers run as the user (JWT). The service-role key exists only for migrations/seed/admin jobs.
4. **Never trust the client.** Tenant, author, role, timestamps and status are derived server-side.
5. **Never fail open.** Absent approver, expired token, missing membership: deny and surface it.
6. **Rules live in the database.** Anything a user must not be able to bypass (stage machine, required fields, quorum, SoD, immutability) is enforced by Postgres functions, constraints and privileges, not only by the API (ADR 0002).

## Authentication and sessions
- Email/password via Supabase Auth, accessed only through `apps/api/src/auth/`.
- Email must be verified before a tenant or any data exists for the account.
- Session cookie: `HttpOnly; Secure (outside local dev); SameSite=Lax or Strict; Path=/`. Tokens never exposed to browser JS or stored in localStorage.
- Sessions are server-side: the cookie holds an opaque session id; the API stores the Supabase tokens and refreshes them single-flight per session, so parallel requests cannot trigger refresh-token reuse detection. Revoking a session closes its WebSockets (ADR 0002).
- Password policy: minimum length 12, checked against common-password list where feasible. Login and sign-up rate-limited per IP and per account.
- Generic responses for sign-up, login, resend, and invite-accept failures (no account enumeration). Equalise timing where practical.
- Logout invalidates the session server-side. Removing a membership terminates that user's sockets for the tenant.
- CSRF: Origin/Referer check plus CSRF token on all unsafe methods. CORS: explicit origin allowlist, no wildcard with credentials.

## Route gating
- Web middleware and API middleware both default-deny. Public allowlist (documented, tested): sign-up, verify-email, login, accept-invite landing, health (no data).
- A test enumerates every registered route and asserts 401 when signed out unless allowlisted.
- `/ws`: authenticated on upgrade (cookie), Origin validated (prevents cross-site WebSocket hijacking), bound to one tenant, message schema validated, size and rate limited.
- **Network exposure:** only the gateway publishes a host port. Postgres, Auth, PostgREST/Kong, Realtime, Studio, Mailpit and the API sit on internal networks. A test inspects the resolved compose config and fails if any other port is published.
- Next.js middleware is UX only (redirects), never the authorization boundary. Pin a patched Next.js version (verify the fix version for the March 2025 middleware-bypass advisory, CVE-2025-29927, when pinning) and have the gateway strip client-supplied internal headers such as `x-middleware-subrequest`.

## Multi-tenancy
- `tenant_id NOT NULL` on every business table. RLS enabled AND forced.
- Policies check membership in the row's tenant against the `memberships` table, not a claim the client could influence.
- Child rows cannot reference a parent in a different tenant (composite FK or constraint).
- Active tenant is chosen server-side from a validated membership; switching re-authorises.
- Cache keys, WebSocket channels, and storage paths include tenant id.
- Mandatory tests: for each table, user in tenant A cannot SELECT, INSERT, UPDATE, DELETE tenant B rows; cannot attach a child to tenant B's parent; WebSocket client in A never receives B's events.

## RBAC and separation of duties
- Permission-based: roles are sets of catalogue permissions per tenant. System roles are immutable; custom roles are Owner-only.
- **Static SoD:** a role (and the union of a user's roles) cannot contain conflicting permissions, e.g. request/submit with approve, member/role management with approve. Conflict pairs are data, checked in one DB function.
- **Dynamic SoD:** requester cannot approve their own request; one decision per approver per request; delegate cannot be the requester or create a conflict.
- No self-escalation: a user cannot grant a role above their own, change their own role, or remove the last Owner. Ownership transfer is explicit and audited.
- Admin administers people; it does not approve deals by default.
- Permission checks are implemented once in DB functions (`has_permission(tenant, action)`) and reused by RLS and API.

## Immutable audit trail
- One append-only `deal_events` ledger holds notes, decisions, stage and field changes and approval decisions; role, membership and invitation changes are append-only too. Corrections are new events with `amends_event_id`, never edits.
- Enforced by: revoked UPDATE/DELETE/TRUNCATE, BEFORE UPDATE/DELETE row triggers raising errors, statement-level TRUNCATE trigger, no cascade deletes (`RESTRICT`), soft-delete for parents.
- Attribution (`author_id`, `created_at`) set by the database, never accepted from the client.
- Tested as normal user, as admin, as table owner and as service role.
- Tamper evidence: each event stores `prev_hash` and `hash` (sha256, computed in the database under a deal row lock); `verify_ledger(deal)` recomputes the chain and CI proves an out-of-band edit is detected. The claim is tamper-evidence plus prevention for every application role, **not** protection from a malicious superuser who can disable triggers; the README says so.
- Actor name and email are snapshotted into each event. Users are deactivated, never hard-deleted. The user directory is tenant-scoped so author lookups cannot leak profiles across tenants. POPIA erasure handling is documented in the README (not legal advice).

## Database functions, grants, concurrency
- `authenticated` has no direct INSERT/UPDATE/DELETE on core tables; writes go through functions (`move_stage`, `post_event`, `decide_approval`, ...) that the API calls as the user.
- Every function: `REVOKE ALL ... FROM PUBLIC` (and `anon`), explicit `GRANT` to the intended role, pinned `search_path`, schema-qualified names. A SQL test lists all functions and fails if any is executable by PUBLIC/anon outside an allowlist.
- Policies use `(select auth.uid())`; helper functions are `STABLE`; indexes lead with `tenant_id`; `memberships(user_id, tenant_id)` is indexed. Views use `security_invoker`.
- Deals carry a `version`; stale writes return 409. Decision functions lock the deal and approval request (`SELECT ... FOR UPDATE`) so quorum is reached exactly once.

## Tokens (verification, invitation)
- 32 bytes from CSPRNG, base64url. Only a SHA-256 hash is stored. Single-use, expiring (verify 24h, invite 7d), bound to email and purpose. Constant-time comparison. Consumption is atomic. Resend invalidates earlier tokens. Tokens are never logged.
- Users are created with `email_confirm: false`; Supabase Auth blocks password login until our consume step flips it.
- Sign-up, resend and invitation endpoints are rate-limited per IP, account and tenant; pending invitations per tenant are capped; invitation emails show the inviter's verified email and say the organisation name is self-declared.
- HTML emails escape every interpolated value (tenant and inviter names are user-controlled) and always include a plain-text part (see MARKUP_STANDARDS).

## Input, output, and data handling
- Validate every input with zod at the boundary; reject unknown fields. Parameterised queries only (via SDK/RPC); no string-built SQL.
- Output encoding by React; no `dangerouslySetInnerHTML`. Note bodies treated as plain text.
- Error responses carry a code and message, never stack traces, SQL, or internal ids not already authorised.
- Logs: no passwords, tokens, cookies, or full request bodies. Include request id, tenant id, user id.
- File uploads: see "Files and object storage" below.

## Browser security headers and CSP
- **Pages:** a nonce-based CSP set per request by Next middleware (headers only; middleware is still not an authorization boundary):
  `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; img-src 'self' data: blob:; connect-src 'self' <ws origin from config>; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
  `'unsafe-eval'` only in development builds. No inline event handlers, no third-party origins, fonts self-hosted.
- **API responses (Hono):** `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` on authenticated JSON.
- **Gateway, every response:** `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` disabling camera, microphone, geolocation and payment, `Cross-Origin-Opener-Policy: same-origin`, HSTS when served over TLS.
- The WebSocket origin in `connect-src` is explicit from config; do not rely on `'self'` matching `ws:`/`wss:` in every browser (verify in the spike).
- **No CSP report endpoint:** it would be an unauthenticated write route. Violations are caught in CI by a headless page load that fails on any CSP console violation. Reporting is a README next step.
- Tests: policy-builder unit tests; compose smoke asserts the headers on `/`, `/login` and `/api/health`; headless load has zero violations.

## Files and object storage
- **BFF rule:** the browser never talks to storage. All file bytes pass through the Hono BFF (uploads and downloads streamed). No presigned URLs, no public bucket, no storage origin in the CSP.
- **One `ObjectStore` port** in `apps/api` with two drivers: `fs` (default, compose named volume) and `s3` (Cloudflare R2 via the S3 API, config only). One contract test suite runs against both. CI holds no storage credentials; real R2 is a documented manual check.
- **Buckets:** separate dev and prod buckets with separate bucket-scoped API tokens (object read/write only, no admin). Config declares the environment and the app refuses to start on a mismatch (for example the prod bucket in a non-production environment).
- **Keys** are server-derived, never client-supplied: `tenants/{tenant_id}/{kind}/{uuid}` for account files; `users/{user_id}/avatar/{uuid}` for avatars (a user belongs to many tenants, so avatars are user-level).
- **Authorization is the `files` row** (RLS, `tenant_id`), not the key. Objects are readable only when a `ready` row exists and the caller may see it. An avatar is visible only to viewers who share at least one tenant with its owner.
- **Uploads:** allowlist by detected content (magic bytes), size cap, filename never used as a path. Images are decoded and re-encoded (avatars: PNG/JPEG/WebP in, 256x256 WebP out, EXIF stripped; no SVG, no animated GIF). Documents are served with `Content-Disposition: attachment` and `nosniff`, never inline from the app origin.
- **Consistency:** write the object, insert the row as `pending`, mark it `ready`; a cleanup job removes orphans. Objects are content-addressed (sha256) and never overwritten; ledger events reference file id and sha256.
- **Hardening to evaluate:** R2 bucket retention/object lock; per-tenant encryption keys (next step). R2 encrypts at rest by default (verify).
- **Tests:** cross-tenant file request returns 404; avatar visibility rule; an SVG or HTML file named `.png` is rejected; oversize rejected; stored avatar is always 256x256 WebP; bucket/environment mismatch refuses to start.

## Secrets and supply chain
- No real secrets in the repo or history. `.env.example` holds clearly fake dev-only values; real deployments inject their own.
- Service-role key and JWT secret never reach `apps/web` or any browser bundle (CI greps the build output).
- Lockfile committed; pinned versions; Dependabot or equivalent; secret scan and `pnpm audit` in CI.
- Containers: see `CONTAINER_STANDARDS.md` (non-root, pinned bases, hadolint, Trivy scan in CI, no secrets in images or build args). GitHub Actions are pinned to commit SHAs with least-privilege `permissions`.

## Pre-merge security checklist (copy into each feature's progress.md)
- [ ] New tables have `tenant_id`, RLS enabled and forced, policies, tests for each role and cross-tenant.
- [ ] New routes declare auth and permission; signed-out test passes.
- [ ] No client-supplied tenant/author/role/timestamp is trusted.
- [ ] Append-only data cannot be mutated by any role including owner/service.
- [ ] Inputs validated by zod; errors do not leak internals.
- [ ] No secrets, tokens, or PII in logs.
- [ ] Web still has no Supabase dependency.
- [ ] New functions are revoked from PUBLIC/anon with explicit grants; no direct write grants added on core tables.
- [ ] No new published host ports (only the gateway).
- [ ] Email and HTML templates escape every interpolated value.
- [ ] Files go through the `ObjectStore` port and the BFF; the browser never reaches storage; no new origin in the CSP.
- [ ] CSP and security headers still present on pages, API and gateway responses.
