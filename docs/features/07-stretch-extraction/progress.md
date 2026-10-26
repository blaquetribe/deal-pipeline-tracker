# 07 Stretch: document extraction: progress

Status: not started
Owner/branch: feat/07-stretch-extraction
Depends on: 03, 08 (uploads go through the ObjectStore port and BFF; see ADR 0004)

## Goal
Upload pdf/word/image and auto-populate fields. Covers GOTCHAS row 17.

## Scope
- In:
- Out (and where it goes):

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
