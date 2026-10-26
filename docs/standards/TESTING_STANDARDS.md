# Testing Standards

Extends ENGINEERING_STANDARDS §8 (behaviour over implementation, deterministic, risk-based). Security negative tests are mandatory (SECURITY_STANDARDS).

## 1. Layers and tools

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Database | pgTAP via `supabase test db` | `supabase/tests/*.sql` | RLS per role and per tenant, grants, immutability, function privileges, hash chain, concurrency of decision functions |
| Unit | **Vitest** (node) | co-located `*.test.ts` | Pure logic: stage machine mirror, quorum maths, token generation, money parsing, validators, email escaping |
| Parity | Vitest + SQL tests sharing `packages/shared/fixtures` | shared + `supabase/tests` | TS mirrors and DB functions agree on the same cases (overlay E1) |
| Component | **Vitest** + React Testing Library + jsdom + user-event | `apps/web` `*.test.tsx` | Behaviour, accessibility, states of client components and hooks |
| API integration | Vitest + Hono `app.request()` against real Supabase Postgres | `apps/api` | Auth gating, permission checks, validation, error mapping, cross-tenant denial through the HTTP layer |
| WebSocket | Vitest with real `ws` client against the running API | `apps/api` | Origin check, tenant binding, no cross-tenant events, reconnect/resync, revoke closes socket |
| Compose smoke | `docker compose up --wait` + script | `scripts/compose-smoke` | Clean-clone path: sign in with seeded user through the gateway, seeded data visible, no extra published ports |
| E2E (extended) | Playwright, one critical journey | `e2e/` | Only if time allows; otherwise README "next steps" |

## 2. Vitest setup
- Single root config using multiple **projects** (`web`: jsdom + React plugin; `api`: node; `shared`: node). Newer Vitest uses `test.projects`; older uses `workspace` files. Pin the version and follow its docs (verify at setup).
- Coverage via V8, reported in CI, **no global threshold gate**. Add thresholds only on `packages/shared` rules and `apps/api` services where they are meaningful.
- Path aliases via `vite-tsconfig-paths`. Strict TS applies to tests too.
- Async Server Components are not supported by Vitest (per Next.js guidance; verify at pin time). Keep logic in plain functions and client components that tests can reach, and cover server-rendered pages through API integration and the compose smoke.

## 3. Component tests
- Query by role, label, or text (`getByRole`, `getByLabelText`). `data-testid` only as a last resort.
- Use `userEvent`, not `fireEvent`. Assert what the user perceives (text, roles, focus, `aria-*`), not component state.
- Mock at the network boundary (MSW) rather than mocking the API client module. Mock the WebSocket with a small fake class for `useRealtime` tests.
- Accessibility assertion on shared components with an axe integration for Vitest (verify the maintained package when adding).
- Every list/query component test covers empty, loading, error, and populated states.
- Snapshots only for small, stable output (email text); never large DOM snapshots.

## 4. Rules for every test
- Deterministic: inject the clock (fake timers or a `now` parameter); no sleeps; no reliance on test order; unique data per test.
- Valid, invalid, empty, boundary, duplicate, and permission-denied cases.
- Authorization tests never mock the database. Each protected operation is tested as: allowed role, forbidden role, signed-out, other tenant.
- Bug fix = failing regression test first.
- No `it.only`/`describe.only` committed (lint rule). No skipped tests without an issue entry in the feature `progress.md`.

## 5. Required security tests (mirrors the checklist)
- Signed-out route sweep: enumerate every registered route and assert 401 unless allowlisted.
- Cross-tenant: SELECT/INSERT/UPDATE/DELETE and child-attachment attempts fail at DB and via API.
- Immutability: UPDATE/DELETE/TRUNCATE on the ledger fail as user, admin, table owner, service role; out-of-band edit makes `verify_ledger` fail.
- Function privileges: no function executable by PUBLIC/anon outside the allowlist; no direct write grants on core tables.
- SoD and approvals: self-approval blocked, duplicate decision blocked, quorum reached exactly once under parallel transactions, stale `version` rejected.
- Sessions: parallel requests across token expiry cause one refresh; revoking a session closes its sockets.
- Compose: only the gateway publishes a host port.
- Headers: CSP and hardening headers present on `/`, `/login` and `/api/health`; a headless load of the login page reports zero CSP violations.
- Storage: the `ObjectStore` contract suite passes on the `fs` driver and, in CI, on the `s3` driver against a local S3-compatible container; cross-tenant file access returns 404; spoofed image types are rejected; stored avatars are always 256x256 WebP; an environment/bucket mismatch refuses to start.

## 6. CI wiring
- Job `test`: install with frozen lockfile, `pnpm typecheck`, `lint`, `stylelint`, `format:check`, `pnpm test --coverage`.
- Job `test-db`: start Supabase Postgres (real `auth` schema), apply migrations from scratch, `pnpm test:db`, then API integration tests.
- Job `docker` (see CONTAINER_STANDARDS) builds images and runs the compose smoke.
- Required checks block merge; no `|| true`.
