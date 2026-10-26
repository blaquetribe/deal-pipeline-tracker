# 01 Schema and security: progress

Status: in progress (slice 1 done and green; slice 2 not started)
Owner/branch: feat/01-schema-security
Depends on: 00

## Goal
Tenancy, RBAC tables, deals, immutable notes, RLS, SQL tests. Covers GOTCHAS rows 2, 3, 4, 15.

## Scope
- In (slice 1): `tenants`, `memberships`, `deals`, `deal_events` (hash-chained ledger), forced RLS, no direct write grants, `post_event`, `verify_ledger`, function-grant allowlist test.
- Slice 2 (next): permission catalogue, system roles, `has_permission`, static SoD, `move_stage`; `post_event` must then require a permission (slice 1 only checks membership, which is not enough for default-deny).
- Out (and where it goes): approvals and quorum (04), auth flows and invitations (02), seed data (06).

## Design notes
Key decisions, schema/API shape, links to ADRs.

## Tasks
- [x] Failing tests written for slice 1: `supabase/tests/01_tenancy_rls.test.sql` (21), `02_ledger_immutability.test.sql` (24)
- [x] Migration, slice 1: `supabase/migrations/20261027000000_tenancy_and_ledger.sql`
- [ ] API
- [ ] Web
- [ ] Docs updated

## Tests
`make test-db`. Slice 1 is green: 56 assertions across three files, from a clean database. The tests set `request.jwt.claims`, which `app.uid()` reads (GOTCHAS 98). Not covered yet: per-role permission checks (slice 2), the function-grant test only scans `public` (the `app` schema is revoked from PUBLIC but not asserted), mutation/sabotage runs of the new tests, and any request through real PostgREST.

Contract the tests fix (names and behaviour the migration must satisfy): `deals.archived_at`, `deals.stage` with a default, `deal_events(id, tenant_id, deal_id, kind, body, actor_id, actor_email, created_at, prev_hash, hash)`; composite FK `(tenant_id, deal_id)`; RESTRICT parents; trigger message `deal_events is append-only` (P0001); `post_event(uuid, text, text)` raising P0002 `deal not found` for non-members; `verify_ledger(uuid) returns boolean`.

## Security checklist (from SECURITY_STANDARDS.md)
- [ ] New tables have `tenant_id`, RLS enabled and forced, policies, tests for each role and cross-tenant.
- [ ] New routes declare auth and permission; signed-out test passes.
- [ ] No client-supplied tenant/author/role/timestamp is trusted.
- [ ] Append-only data cannot be mutated by any role including owner/service.
- [ ] Inputs validated by zod; errors do not leak internals.
- [ ] No secrets, tokens, or PII in logs.
- [ ] Web still has no Supabase dependency.

## Log
- 2026-10-26: slice 1 tests written and run red (14 passed from file 00, 9 failed, files 01 and 02 abort at the first fixture insert).
- 2026-10-26: slice 1 migration written; all green. Found that `auth.uid()` returns null under our PostgREST settings; added `app.uid()` (GOTCHAS 98). Owner roles bypass RLS in this image (GOTCHAS 99), so the ledger relies on privileges plus triggers. Owner roles bypass RLS in this image (GOTCHAS 99), so the ledger's protection is privileges plus triggers.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
