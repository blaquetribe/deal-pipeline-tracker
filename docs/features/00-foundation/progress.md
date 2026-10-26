# 00 Foundation: progress

Status: not started
Owner/branch: feat/00-foundation
Depends on: none

## Goal
Monorepo, tooling, compose skeleton, CI. Covers GOTCHAS rows 3, 6, 7, 19, 20, 25, 36, 37.

## Scope
- In: pnpm workspaces; `tsconfig.base.json` (overlay E5); ESLint, Prettier, Stylelint; Vitest root config with web/api/shared projects; `supabase test db` wiring; Dockerfiles for web and api; gateway config; compose with internal networks and only the gateway published; `.env.example`; CI jobs `test`, `test-db`, `docker` (hadolint, Buildx build, Trivy, compose smoke, GHCR push on main/tags); secret scan; Dependabot; gateway hardening headers and Hono API headers (ADR 0004); `sharp` build check on Alpine and arm64; spikes for the *verify* items (WS through gateway, Next patched version, Realtime with server-held JWT, Vitest projects syntax).
- Out (and where it goes): schema (01), auth (02), app features (03+).

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
