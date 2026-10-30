# 02 Auth and onboarding: progress

Status: implemented; refresh-token rotation is coordinated through Postgres across API instances. Production SMTP relay behavior and the refresh crash window remain documented limitations.
Owner/branch: feat/02-api-auth (continues the feature 02 database work)
Depends on: 01

## Goal
Sign-up with verification, sessions, tenant switcher, invitations, Mailer. Covers GOTCHAS rows 1, 5, 14, 18, 21, 24, 28, 29, 31, 41.

## Scope
- In: sign-up, email verification, login, **password reset** (token flow; the mockup shows "Forgot password?" but nothing designs it), server-side sessions with in-process and database-coordinated refresh, tenant switcher, invitations, Mailer and Mailpit, rate limits, nonce-based CSP in Next `proxy.ts` (headers only; mechanism confirmed in the installed Next docs, proven by a test here), signed-out route sweep, and the registration onboarding flow (owner and invitee) designed in `onboarding-flow.md`. No SSO, no magic link.
- Out (and where it goes): avatars (08), approvals (04).

## Design notes
- ADR 0015: sessions in a Postgres table; JWT-less work through a narrow `api_service` role reached via PostgREST. Decided by the owner on 2026-10-26.
- Slice A (database, done): `api_service` role (no table privileges, EXECUTE on eight functions), `api_sessions` and `email_tokens` (RLS forced, no policies, reachable only through the functions), `session_*` and `token_*` functions, `profiles` with a tenant-scoped directory (`app.shares_tenant_with`) and `profile_upsert`.
- Token consumption sets `auth.users.email_confirmed_at` in the database, atomically with consuming the token, instead of calling the GoTrue admin API afterwards (a crash between two calls would strand the user). The auth module still owns everything else about GoTrue.
- Slice B (database, done): tenant settings (`timezone`, `default_currency`, `closing_soon_days` initially defaulted to 30); the onboarding state machine as data (`onboarding_steps`, `onboarding_progress`; owner flow profile, organisation, defaults, invite, done; invitee flow profile, done) with `onboarding_state/advance/skip`; `create_organisation` (verified email, only at its step, once per user remembered by the append-only tenant trail, validated time zone) as the only way users create tenants (`create_tenant` is revoked from `authenticated`); `update_tenant_settings` (needs `role.manage`); `token_consume` for `verify_email` now starts the owner flow; `invitations` (token hash never readable by users, one pending per email, 7-day expiry, capped at 50 pending per tenant, same no-escalation rule as `grant_role`), `invite_member`, `revoke_invitation`, `invitation_preview` and `invitation_accept` (api_service; email-bound, atomic, verifies the invited address, reactivates a deactivated member, starts the invitee flow, SoD trigger still applies). New tenant trail kinds; an explicit `app.actor` setting lets an api_service-run function record the invitee as the actor (explicit actor wins, cleared at the end of the function).
- ADR 0011 explicitly supersedes the earlier 30-day assumption. Migration `20261106000000_closing_soon_default.sql` sets the future-tenant default to 60 days without rewriting existing tenant choices. `role.manage` (Owner only) guards organisation settings rather than a new permission, because system roles are immutable after seeding.
- The owner/invitee onboarding order now comes from `packages/shared/fixtures/onboarding-steps.json`; Vitest and pgTAP compare the TypeScript and database definitions to that same fixture. Both parity checks pass.
- API and web implementation includes the GoTrue adapter, session resolver, auth/onboarding/invitation routes, SMTP templates and transport, auth pages, and nonce CSP proxy.
- Onboarding now has step-specific URLs. The active step still comes from the database; visiting a different step URL redirects to that canonical step. Validation failures focus a linked error summary.
- Database slices C–F add exact account lookup, authenticated tenant choices, permission-checked pending invitation listing, and ADR 0011's future-tenant 60-day default. Their focused tests and the complete pgTAP suite pass.
- The verification flow is aligned with ADR 0009: email verification does not create a session; password sign-in follows.

## Tasks
- [x] Slice A tests written first (`supabase/tests/08_api_service.test.sql`, 46 assertions), run red, then green
- [x] Slice B tests written first and run red (`09_onboarding` 36, `10_invitations` 37), then green
- [x] Migration slice A: `20261101000000_api_service_sessions_tokens_profiles.sql`
- [x] Migration slice B: `20261102000000_onboarding_and_invitations.sql`
- [x] API implementation: GoTrue adapter; verification, resend, login/logout, reset, invitation and onboarding routes; session refresh, CSRF and rate-limit declarations; SMTP mailer.
- [x] Web implementation: auth and invitation pages, onboarding flow, session-backed API helpers, signed-out page policy, tenant switcher and nonce CSP.
- [x] Add step-specific onboarding routes and an accessible, field-linked validation summary.
- [x] Validate API and web with typecheck, lint, stylelint, format check, full Vitest, production build and compose smoke test.
- [x] Validate the account lookup, tenant choices, pending invitation and 60-day default migrations and full database suite against the current compose stack.
- [x] Align verification/session behavior with ADR 0009: manual password sign-in follows email verification.
- [x] Update progress and handoff records to describe the current tree.

## Tests
What is covered, where it lives, how to run it.

- `pnpm typecheck`, `pnpm lint`, `pnpm stylelint`, `pnpm format:check`, `pnpm test`, and `pnpm build` pass locally. Vitest reports 28 files and 405 passing tests. Lint is clean. The web build uses Next's Webpack builder because Turbopack worker startup cannot bind a local port in this environment.
- `make COMPOSE='podman compose' test-db` passes: 16 pgTAP files, 337 assertions, no failures.
- `scripts/compose-smoke.sh` passes against Podman, including the build, service health, gateway/network boundaries, auth, realtime, role switching, and negative migration/test checks. The script now detects Podman and strips terminal color codes from command output before comparing protocol results.

## Security checklist (from SECURITY_STANDARDS.md)
- [x] New database tables/functions have corresponding privilege and pgTAP coverage in slices A–E; verify the new migrations with the full database suite.
- [x] Routes use public/session route constructors and auth tests cover key signed-out and CSRF paths; full suite passes.
- [x] Tenant, author, role and timestamps are sourced from session/DB context for the implemented flows.
- [x] Existing append-only database design remains in place; new account lookup migration is read-only.
- [x] Request and RPC response inputs are schema validated; generic auth responses avoid account enumeration.
- [x] Verify logs and runtime config through lint/review and compose smoke.
- [x] Web imports shared schemas and does not use Supabase.

## Tests
Historical Feature 02 verification passed 337 pgTAP assertions across 16 files, 405 Vitest tests across 28 files, and the full compose smoke. On 2026-10-29, the complete current pgTAP suite passes 596 assertions across 30 files, including the new refresh-lease tests.

## Log
- 2026-10-30: Fixed tenant-switch refresh behavior. After `/auth/tenant` accepts a new active tenant, the browser reloads so mount-only tenant data requests rerun under the server-selected tenant. Added a component regression assertion; full Vitest, typecheck, lint, stylelint, formatting, and production build pass. Seeded browser verification showed all five Asteron deals immediately after switching. No DB changes were needed.
- 2026-10-26: ADR 0015. Slice A written test-first (red: role missing), migration, green. pgTAP lives in the `extensions` schema, so the test grants `api_service` usage on it inside its own rolled-back transaction; production does not. Real PostgREST check: role switching and `app.uid()` work. Smoke script extended (not sabotage-tested; `shellcheck` not installed locally, CI runs it).

- 2026-10-26: slice B written test-first (red: missing functions and tables), migration, green, 313 assertions. Four sabotage runs (once-per-user check, invitation email binding, token hash readable, invitation cap) each failed the intended test. A test caught that a leftover user identity on the connection would have beaten the invitee as actor; fixed by letting an explicit `app.actor` win.
- 2026-10-28: Coverage follow-up added auth API/form/onboarding regression tests and fixed malformed `/onboarding/skip/:step` input to return a stable 400 `invalid_step` response instead of leaking a Zod exception as a 500. The full suite passes 502 tests and all local coverage thresholds pass; GitHub CI for the follow-up PR remains pending.
- 2026-10-29: Replaced process-local-only refresh coordination with a Postgres lease per session. The API service can claim a short hashed lease, rotate tokens only while holding it, and wait for another instance's rotation; direct uncoordinated token writes are no longer executable by `api_service`. Added migration `20261126000000_api_session_refresh_claim.sql`, pgTAP, and two-resolver regression coverage. Coverage regression tests verify lease disappearance fails closed and malformed encrypted tokens are rejected. Full Vitest passes (646 passed, 1 skipped), coverage thresholds pass (85.06% global branches; 90%+ API branches), pgTAP passes (596 assertions across 30 files), and typecheck, lint, stylelint, format check and build pass. PR #32's quality CI is pending after the coverage fix.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").

- SMTP uses Nodemailer with configurable implicit TLS or required STARTTLS; optional credentials must be paired and are rejected unless TLS is enabled. Mailpit remains the local no-auth default. Production relay connectivity and certificate behavior still need deployment verification.
- **Refresh crash window:** if an API instance crashes after GoTrue rotates a refresh token but before the new token is committed to the session row, a retry after the lease expires can invalidate the session. The database lease prevents concurrent API instances from using the same token simultaneously but cannot make GoTrue's external rotation and Postgres persistence one transaction.
- Component tests cover stepper semantics, canonical step selection, redirects from a mismatched URL, and focus/link behavior for validation errors.
- Password reset consumes the one-use token before calling GoTrue to change the password. If GoTrue fails after consumption, the user must request another reset link.
- Existing organisations retain their current `closing_soon_days`; the forward migration changes only the default for newly created tenants.
