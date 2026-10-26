# Presentation Notes: How We Resolved the Brief's Gaps

Source material for the team presentation. Each item: the problem, the resolution, where it is enforced, how we prove it, and the trade-off. "Verify" marks claims that must be confirmed by a spike or test before we present them as fact.

## Suggested talk track
1. The brief in one slide: what was asked, what was deliberately left open.
2. Architecture: UI -> gateway -> Hono -> Supabase; why the UI knows nothing of Supabase.
3. Security story: defence in depth, authorization in Postgres, tamper-evident ledger.
4. Multi-tenancy, onboarding, roles, approvals and absence handling.
5. Realtime without breaking tenant isolation.
6. Proof: the test suite (cross-tenant, immutability, SoD, signed-out route sweep).
7. Honest limits and what we would do next.

## Architecture in one picture
```
Browser -> Gateway (Caddy/nginx, only published port)
             |-- /      -> web (Next.js, UI only, no Supabase)
             |-- /api   -> api (Hono)  -- user JWT --> Supabase (internal network only)
             |-- /ws    -> api (Hono WebSocket) -- per-user Realtime sub --> Supabase
```
Supabase (Postgres, Auth, Realtime, Mailpit) is on an internal network and never published.

---

## A. Findings that changed earlier decisions

### 1. WebSocket cannot ride the Next.js proxy
- **Problem:** ADR 0001 proxied the API through a Next route handler. Route handlers do not cleanly proxy WebSocket upgrades, and `/ws` is required.
- **Resolution:** a gateway container (Caddy or nginx) gives one origin: `/` -> web, `/api` and `/ws` -> api. Next.js stops being a proxy.
- **Enforced:** compose topology; only the gateway publishes a port.
- **Proof:** compose smoke test (HTTP and WS through the gateway); Origin check test on `/ws`.
- **Trade-off:** one more container; in exchange, a single origin (no CORS) and a single public surface.
- **Verify:** our claim about Next rewrites under `next start` is unconfirmed; the gateway makes it moot.

### 2. Supabase must not be reachable; rules live in the database
- **Problem:** published Kong/PostgREST/Studio would bypass the "UI knows no Supabase" boundary; Studio ships with default credentials. Rules enforced only in Hono (state machine, quorum) would be bypassable by anyone with a valid JWT reaching PostgREST.
- **Resolution:** Supabase on an internal network, nothing published except the gateway. Core tables give `authenticated` read access via RLS only; **writes go through DB functions** (`move_stage`, `post_event`, `decide_approval`, ...) that enforce the state machine, quorum and SoD. Direct INSERT/UPDATE/DELETE grants on core tables are revoked. Hono calls these functions as the user.
- **Enforced:** compose networks; privileges and functions in migrations.
- **Proof:** SQL tests that a role with a valid JWT cannot write core tables directly; network test that Supabase ports are not published.
- **Trade-off:** more SQL, less ORM convenience; far stronger story ("you cannot skip our rules by skipping our API").

### 3. Session refresh without logging users out
- **Problem:** Supabase access tokens expire (about 1h); refresh tokens rotate. Parallel requests that refresh at once can trigger reuse detection and kill the session. The WebSocket outlives a token.
- **Resolution:** server-side sessions. The browser holds an opaque, httpOnly session id; the API stores the Supabase tokens against it and refreshes under a per-session lock (single flight). The WebSocket re-authenticates through the same session store and proactively refreshes before expiry; a revoked session closes its sockets.
- **Enforced:** `apps/api/src/auth/` (the only module touching Supabase Auth).
- **Proof:** concurrency test (N parallel requests across expiry -> one refresh, no logout); revoke-closes-socket test.
- **Trade-off:** session table and lock logic; tokens never reach the browser.

### 4. One immutable ledger instead of many append-only tables
- **Problem:** the brief says "notes or decisions"; an audit trail must also show who changed a deal's value or stage. Several append-only tables would multiply the immutability mechanism.
- **Resolution:** one append-only `deal_events` table with a `kind` (note, decision, stage_change, field_change, approval_decision, ...), `actor_id`, snapshot of the actor's name/email, payload (jsonb, schema validated per kind), optional `amends_event_id`. Deal field edits and stage moves write ledger rows in the same transaction as the change.
- **Enforced:** privileges revoked, UPDATE/DELETE/TRUNCATE triggers, RESTRICT FKs, DB-set author and time.
- **Proof:** mutation attempts as user, admin, owner and service role all fail.
- **Trade-off:** a generic payload needs strict per-kind validation; gain is a single timeline UI and a single audit story.

### 5. Immutability has a ceiling: make tampering detectable
- **Problem:** a table owner/DBA can disable triggers.
- **Resolution:** per-deal hash chain. Each event stores `prev_hash` and `hash = sha256(prev_hash || canonical(event))`, computed in the database (pgcrypto) under a deal row lock. A `verify_ledger(deal)` function recomputes the chain.
- **Proof:** test that altering a row out-of-band (as superuser) makes `verify_ledger` fail.
- **Honest limit (say it out loud):** we guarantee tamper-evidence plus strong prevention for every application role, not protection from a malicious superuser. A production answer is WORM/off-DB anchoring (next steps).

### 6. POPIA versus immutability
- **Problem:** the firm is South African; erasure rights collide with permanent attributed records.
- **Resolution:** users are deactivated, never hard-deleted. Events snapshot display name and email at posting time so history survives renames and removals. The user directory is tenant-scoped, so author lookups cannot leak profiles across tenants. The README states the retention stance and what erasure would mean (pseudonymise the directory, retain the ledger with legal basis). Not legal advice; flag for the firm's compliance.
- **Proof:** removed-user test (history intact, no login, not visible to other tenants).

---

## B. Build-time traps

### 7. CI must run real Supabase Postgres
- **Problem:** `auth.uid()` and the `authenticated`/`service_role` roles do not exist in vanilla Postgres; migrations would fail or, worse, tests would not exercise real RLS.
- **Resolution:** CI uses the Supabase Postgres image (or `supabase start`) and applies all migrations from scratch, then runs SQL and API integration tests.
- **Trade-off:** slower CI; honest tests.

### 8. Function grants and RLS performance
- **Problem:** Postgres grants `EXECUTE` to PUBLIC on new functions, including `SECURITY DEFINER` ones. RLS helper calls can be evaluated per row.
- **Resolution:** every function: `REVOKE ALL ... FROM PUBLIC`, explicit `GRANT` to the intended role, pinned `search_path`. Policies use `(select auth.uid())`; index `memberships(user_id, tenant_id)` and `tenant_id`-leading indexes everywhere.
- **Proof:** SQL test lists all functions and asserts none is executable by `anon`/PUBLIC unless allowlisted.

### 9. Concurrency
- **Problem:** two users moving the same deal, or two last approvers hitting quorum at once, can double-count.
- **Resolution:** `version` column with optimistic concurrency on deals (stale write -> 409); `SELECT ... FOR UPDATE` on the deal / approval request inside the decision function; transitions are idempotent.
- **Proof:** parallel-transaction tests (quorum reached exactly once; stale update rejected).

### 10. Next.js middleware is not an auth boundary
- **Problem:** Next middleware-only authorization was bypassable via a forged header (CVE-2025-29927, March 2025; verify the exact patched versions when pinning).
- **Resolution:** the API is the gate. Next middleware is UX only (redirects). Pin a patched Next version; strip internal headers at the gateway.
- **Proof:** signed-out route sweep hits the API directly.

### 11. Open sign-up plus invitations = abuse surface
- **Problem:** anyone can become an Owner, make us email arbitrary addresses, or impersonate an organisation name.
- **Resolution:** rate limits (per IP, per account, per tenant), pending-invite cap per tenant, invitation emails show the inviter's verified email and make clear the tenant is self-declared, tenants exist only after email verification.
- **Proof:** rate-limit and cap tests.

### 12. Realtime mechanism: choice recorded
- **Options:** (a) Realtime `postgres_changes` per user JWT (RLS evaluated per subscriber); (b) broadcast-from-database on private channels with RLS on channel messages (scales better, more setup).
- **Decision:** (a) for now; the ledger is INSERT-only and parents are soft-deleted, so the known DELETE-not-filtered limitation never applies. Tenant filter plus RLS. (b) documented as the scale path.
- **Verify:** confirm current Supabase behaviour in a spike before relying on it.
- **Proof:** tenant A client never receives tenant B events.

### 13. Email verification design
- **Decision:** our own hashed single-use tokens for both verification and invitations (one mechanism, one test suite). The Supabase user is created with `email_confirm: false`, so GoTrue itself rejects password login until our consume step flips the flag. We do not rely on GoTrue's own emails.
- **Trade-off:** more custom code than using GoTrue's flow; chosen for uniformity and the explicit token requirement.

---

## C. Brief details we under-weighted

### 14. Required fields per stage
- **Problem:** "auto-populate required fields at a given step" implies stage-gated required fields.
- **Resolution:** a stage requirements table (stage -> required fields) in `packages/shared` mirrored by a DB check inside `move_stage`. A deal cannot enter a stage without its fields.
- **Proof:** transition tests per stage.

### 15. Currency
- **Resolution:** dashboard totals are per currency; no summing across currencies. FX conversion is out of scope (next steps).

### 16. Seed dates
- **Resolution:** the seed generates dates relative to now, so "closing soon" is populated whenever the reviewer opens it. The seed is idempotent and gated by a dev flag.
- **Proof:** CI seeds with a shifted clock and asserts a non-empty closing-soon list.

### 17. Visibility is tenant-level
- **Decision:** access is by tenant plus role. Per-deal information barriers (need-to-know teams, ethical walls) are **not** built; the schema keeps room for a deal membership table. Stated in the README as a conscious limit.

### 18. "CI/CD" and the live database
- **Decision:** CI on every PR. CD = build and push images to GHCR on tags/main; no hosted deployment. The live-database path is documented: `supabase db push` from migrations only, never by hand; the pipeline shows the command but we do not hold production credentials.

### 19. Resource weight and portability
- **Resolution:** pinned multi-arch images, no host ports except the gateway, documented RAM and first-run time, healthchecks and ordered startup, verified from a fresh clone on the reviewer's likely setups (Apple Silicon and x86).

### 20. Credentials and sample data
- **Resolution:** seeded users documented as dev-only and gated by an env flag; fictional companies and people only; neutral product name and no CVC branding.

### 21. Corrections in an immutable trail
- **Resolution:** `amends_event_id` links a correcting event to the original; the UI shows the amendment beside the original. Nothing is edited.

### 22. Showing Claude Code as core, not bolt-on
- **Resolution:** small commits per feature; `AGENTS.md`/`CLAUDE.md`; standards loaded up front; project-level `.claude/` hooks/commands (typecheck and test gates); `docs/AI_USAGE.md` log feeding the README reflection.

---

## D. Standards and tooling (what keeps the codebase honest)
- **Layered standards:** security > project overlay > org-wide engineering base (adopted unmodified). Ten recorded exceptions (E1-E10), each with a reason; the biggest is E1: Postgres is the authority for consequential rules, TypeScript mirrors them and **parity tests** prove they agree.
- **Testing:** Vitest for unit and component tests (React Testing Library, role/label queries, MSW), pgTAP for RLS/grants/immutability, real-database API and WebSocket integration tests, and a compose smoke test as the clean-clone proof.
- **Markup:** semantic, accessible JSX with a keyboard path for stage moves, live-region announcements for realtime changes, and escaped, typed HTML email templates.
- **Containers and CI:** multi-stage non-root Dockerfiles per app; CI lints (hadolint), builds with Buildx, scans (Trivy), smoke-tests the whole stack, and pushes multi-arch images to GHCR from main. No hosted deployment, by design.
- **Verify before presenting as fact:** Next.js WebSocket proxying (moot with the gateway), patched Next version, Realtime with server-held JWTs, Vitest projects syntax, axe package, Server Component test limits.

## E. Browser hardening and files (ADR 0004)
- **BFF:** the Hono service is the only thing the browser talks to (via the gateway); it alone holds Supabase and storage credentials.
- **CSP:** nonce-based policy from Next middleware, locked-down policy on API responses, hardening headers at the gateway; no third-party origins and no report endpoint (it would be an unauthenticated write route). CI proves it with a headless load that must show zero violations.
- **Storage:** one `ObjectStore` port, `fs` driver for the reviewer path, Cloudflare R2 (S3 API) by config with separate dev/prod buckets and bucket-scoped tokens. Files are authorised by a tenant-scoped `files` row, keys are server-derived, and bytes stream through the BFF, so no presigned URLs, no CSP hole, no published storage port.
- **Avatars:** initials by default; optional upload is re-encoded (256x256 WebP, EXIF stripped) so SVG scripts and polyglot files never reach other users; visible only to people sharing a tenant; no Gravatar (it leaks an email hash).
- **Honest trade-off:** proxying costs API bandwidth; presigned URLs for large files are a next step.

## Honest limits (present these proudly, not apologetically)
- Tamper-evident, not DBA-proof, audit ledger.
- Tenant-level visibility only (no per-deal barriers).
- No FX, no hosted deployment, no legal sign-off on POPIA.
- Scope exceeds the 6-10h guidance by choice; the cut list in `PROGRESS.md` shows the order we would drop things.

## Demo script (what to show live)
1. Sign up a new organisation; open Mailpit; verify; land as Owner.
2. Invite a teammate; accept; role limits visible.
3. Tenant switch: seeded firm B shows nothing of firm A.
4. Move a deal to IC Review; open approval; quorum progress; absent approver and delegation.
5. Try to edit or delete a note in the UI, via the API, and via SQL: all refused; run `verify_ledger`.
6. Two browsers: a stage change appears live in the other; a different tenant sees nothing.
7. Run the test suite output as the closing slide.
