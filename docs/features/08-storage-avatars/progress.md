# 08 Storage and avatars: progress

Status: not started
Owner/branch: feat/08-storage-avatars
Depends on: 02, 03

## Goal
Object storage behind one `ObjectStore` port (fs default, Cloudflare R2 via S3 API by config), a tenant-scoped `files` table, BFF-proxied upload/download, and avatars (initials by default, optional upload re-encoded with sharp). Covers GOTCHAS rows 41-49.

## Scope
- In: `ObjectStore` port; `fs` driver (compose named volume); `s3` driver for R2 (extended tier); `files` table with RLS and pending/ready states; BFF upload/download endpoints (streamed, no presigned URLs); sharp avatar pipeline (PNG/JPEG/WebP in, 256x256 WebP out, EXIF stripped); initials fallback; orphan cleanup job; contract test suite run against both drivers; env/bucket guard.
- Out (and where it goes): tenant logos (not planned); presigned URLs, per-tenant encryption keys, virus scanning (README next steps); document extraction (07).

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
