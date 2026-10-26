# 02 Auth and onboarding: progress

Status: not started
Owner/branch: feat/02-auth-onboarding
Depends on: 01

## Goal
Sign-up with verification, sessions, tenant switcher, invitations, Mailer. Covers GOTCHAS rows 1, 5, 14, 18, 21, 24, 28, 29, 31, 41.

## Scope
- In: sign-up, email verification, login, server-side sessions with single-flight refresh, tenant switcher, invitations, Mailer and Mailpit, rate limits, nonce-based CSP in Next middleware (headers only), signed-out route sweep.
- Out (and where it goes): avatars (08), approvals (04).

## Design notes
Key decisions, schema/API shape, links to ADRs.

## Tasks
- [ ] Failing tests written (security/negative first)
- [ ] Migration(s)
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

## Log
Dated notes: what changed, what was learned, problems.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
