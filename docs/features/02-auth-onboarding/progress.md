# 02 Auth and onboarding: progress

Status: in progress (slice A, database, green; API and web not started)
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
- Slice B (next, database): tenant settings (`timezone`, `default_currency`, `closing_soon_days`), `create_organisation` (verified, once per user, owner flow), `onboarding_progress` state machine with a shared fixture, invitations (hashed, email-bound, capped per tenant) and acceptance.
- Then: API auth module (sign-up, verify, resend, login, logout, refresh single-flight, CSRF, rate limits, Mailer), signed-out route sweep, web pages and nonce CSP.

## Tasks
- [x] Slice A tests written first (`supabase/tests/08_api_service.test.sql`, 46 assertions), run red, then green
- [ ] Slice B tests (onboarding, organisation, invitations)
- [x] Migration slice A: `20261101000000_api_service_sessions_tokens_profiles.sql`
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
`make test-db` (240 assertions in total, slice A is `08_api_service`) and the compose smoke test, which now also proves PostgREST switches roles from the JWT.

## Log
- 2026-10-26: ADR 0015. Slice A written test-first (red: role missing), migration, green. pgTAP lives in the `extensions` schema, so the test grants `api_service` usage on it inside its own rolled-back transaction; production does not. Real PostgREST check: role switching and `app.uid()` work. Smoke script extended (not sabotage-tested; `shellcheck` not installed locally, CI runs it).

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
