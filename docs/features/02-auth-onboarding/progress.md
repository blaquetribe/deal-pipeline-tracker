# 02 Auth and onboarding: progress

Status: in progress (database slices A and B green; API and web not started)
Owner/branch: feat/02-auth-onboarding
Depends on: 01

## Goal
Sign-up with verification, sessions, tenant switcher, invitations, Mailer. Covers GOTCHAS rows 1, 5, 14, 18, 21, 24, 28, 29, 31, 41.

## Scope
- In: sign-up, email verification, login, **password reset** (token flow; the mockup shows "Forgot password?" but nothing designs it), server-side sessions with single-flight refresh, tenant switcher, invitations, Mailer and Mailpit, rate limits, nonce-based CSP in Next `proxy.ts` (headers only; mechanism confirmed in the installed Next docs, proven by a test here), signed-out route sweep, and the registration onboarding flow (owner and invitee) designed in `onboarding-flow.md`. No SSO, no magic link.
- Out (and where it goes): avatars (08), approvals (04).

## Design notes
- ADR 0015: sessions in a Postgres table; JWT-less work through a narrow `api_service` role reached via PostgREST. Decided by the owner on 2026-10-26.
- Slice A (database, done): `api_service` role (no table privileges, EXECUTE on eight functions), `api_sessions` and `email_tokens` (RLS forced, no policies, reachable only through the functions), `session_*` and `token_*` functions, `profiles` with a tenant-scoped directory (`app.shares_tenant_with`) and `profile_upsert`.
- Token consumption sets `auth.users.email_confirmed_at` in the database, atomically with consuming the token, instead of calling the GoTrue admin API afterwards (a crash between two calls would strand the user). The auth module still owns everything else about GoTrue.
- Slice B (database, done): tenant settings (`timezone`, `default_currency`, `closing_soon_days` default 30); the onboarding state machine as data (`onboarding_steps`, `onboarding_progress`; owner flow profile, organisation, defaults, invite, done; invitee flow profile, done) with `onboarding_state/advance/skip`; `create_organisation` (verified email, only at its step, once per user remembered by the append-only tenant trail, validated time zone) as the only way users create tenants (`create_tenant` is revoked from `authenticated`); `update_tenant_settings` (needs `role.manage`); `token_consume` for `verify_email` now starts the owner flow; `invitations` (token hash never readable by users, one pending per email, 7-day expiry, capped at 50 pending per tenant, same no-escalation rule as `grant_role`), `invite_member`, `revoke_invitation`, `invitation_preview` and `invitation_accept` (api_service; email-bound, atomic, verifies the invited address, reactivates a deactivated member, starts the invitee flow, SoD trigger still applies). New tenant trail kinds; an explicit `app.actor` setting lets an api_service-run function record the invitee as the actor (explicit actor wins, cleared at the end of the function).
- Decisions to confirm with the owner: the closing-soon default is 30 days per `onboarding-flow.md` (ADR 0011 speaks of a 60-day window; they may be different things, check when feature 03 uses it); `role.manage` (Owner only) guards organisation settings rather than a new permission, because system roles are immutable after seeding.
- Debt: the onboarding step order has no SQL/TS parity fixture yet (the design asks for shared fixtures); add it with the TS mirror when the web stepper is built.
- Then: API auth module (sign-up, verify, resend, login, logout, refresh single-flight, CSRF, rate limits, Mailer), signed-out route sweep, web pages and nonce CSP.

## Tasks
- [x] Slice A tests written first (`supabase/tests/08_api_service.test.sql`, 46 assertions), run red, then green
- [x] Slice B tests written first and run red (`09_onboarding` 36, `10_invitations` 37), then green
- [x] Migration slice A: `20261101000000_api_service_sessions_tokens_profiles.sql`
- [x] Migration slice B: `20261102000000_onboarding_and_invitations.sql`
- [ ] API
- [ ] Web
- [ ] Docs updated

## Tests
What is covered, where it lives, how to run it.

## Security checklist (from SECURITY_STANDARDS.md)
- [ ] New tables have `tenant_id`, RLS enabled and forced, policies, tests for each role and cross-tenant.
- [ ] New routes declare auth and permission; signed-out test passes.
- [ ] No client-supplied tenant/author/role/timestamp is trusted.
- [ ] Append-only data cannot be mutated by any role including owner/service.
- [ ] Inputs validated by zod; errors do not leak internals.
- [ ] No secrets, tokens, or PII in logs.
- [ ] Web still has no Supabase dependency.

## Tests
`make test-db` (313 assertions in total; slice A is `08_api_service`, slice B is `09_onboarding` and `10_invitations`) and the compose smoke test, which now also proves PostgREST switches roles from the JWT.

## Log
- 2026-10-26: ADR 0015. Slice A written test-first (red: role missing), migration, green. pgTAP lives in the `extensions` schema, so the test grants `api_service` usage on it inside its own rolled-back transaction; production does not. Real PostgREST check: role switching and `app.uid()` work. Smoke script extended (not sabotage-tested; `shellcheck` not installed locally, CI runs it).

- 2026-10-26: slice B written test-first (red: missing functions and tables), migration, green, 313 assertions. Four sabotage runs (once-per-user check, invitation email binding, token hash readable, invitation cap) each failed the intended test. A test caught that a leftover user identity on the connection would have beaten the invitee as actor; fixed by letting an explicit `app.actor` win.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
