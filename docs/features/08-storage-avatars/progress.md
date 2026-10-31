# 08 Storage and avatars: progress

Status: done (merged in PR #17; real Cloudflare R2 object round trip verified 2026-10-31)
Owner/branch: main
Depends on: 02, 03

## Goal
Object storage behind one `ObjectStore` port (fs default, Cloudflare R2 via S3 API by config), a tenant-scoped `files` table, BFF-proxied upload/download, and avatars (initials by default, optional upload re-encoded with sharp). Covers GOTCHAS rows 41-49.

## Scope
- In: `ObjectStore` port; `fs` driver (compose named volume); `s3` driver for R2 (extended tier); `files` table with RLS and pending/ready states; BFF upload/download endpoints (streamed, no presigned URLs); sharp avatar pipeline (PNG/JPEG/WebP in, 256x256 WebP out, EXIF stripped); initials fallback; orphan cleanup job; contract test suite run against both drivers; env/bucket guard.
- Out (and where it goes): tenant logos (not planned); presigned URLs, per-tenant encryption keys, virus scanning (README next steps); document extraction (07).

## Design notes
Config (ADR 0004 update): `OBJECT_STORE_DRIVER=fs|s3`, `STORAGE_ENDPOINT` (account endpoint, no bucket), `STORAGE_REGION` (`auto`, verify), `STORAGE_BUCKET=deal-pipeline-tracker`, `STORAGE_KEY_PREFIX=Dev/|Prod/`, `STORAGE_FORCE_PATH_STYLE`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. Startup guard: prefix must match the environment. No public bucket URL. Needs a dedicated token (see HANDOFF).

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s)
- [x] API
- [x] Web
- [x] Docs updated

## Tests
What is covered, where it lives, how to run it.

- `supabase/tests/25_storage_files.test.sql`: RLS, tenant isolation, RPC grants, malformed paths, and stale-pending cleanup.
- `apps/api/src/storage/*.test.ts`: filesystem safety/immutability, cleanup, and S3-compatible contract tests. The S3 test runs against RustFS when `STORAGE_TEST_*` is configured; CI now supplies a disposable RustFS service.
- `apps/api/src/features/files/routes.test.ts`: upload validation, permission/session failures, response headers, and BFF download behavior.
- `apps/web/src/features/auth/profile-avatar.test.tsx` and `apps/web/src/features/deals/deal-files.test.tsx`: avatar upload/fallback and attachment UI behavior.
- Local checks on 2026-10-29: 588 Vitest tests pass (1 S3 integration test skipped without a local RustFS endpoint); coverage passes (85.72% global branches; 91.17% API branches), as do typecheck, lint, stylelint, format check, and production build. Isolated local pgTAP could not complete because the Podman API repeatedly returned unexpected EOF while starting the migration job; GitHub CI pgTAP passed.

## Security checklist (from SECURITY_STANDARDS.md)
- [x] New tables have `tenant_id`, RLS enabled and forced, policies, and cross-tenant tests.
- [x] New routes declare auth and permission; signed-out tests pass.
- [x] Tenant and owner metadata are derived from the authenticated session; client timestamps, roles, and object keys are not accepted.
- [x] No append-only audit data was added; file state transitions and stale pending cleanup use narrow database functions.
- [x] Inputs validated by zod; errors do not expose storage internals.
- [x] No secrets, tokens, or PII in logs.
- [x] Web still has no Supabase dependency.

## Log
Dated notes: what changed, what was learned, problems.

- 2026-10-29: Added the private tenant-scoped files table and narrow metadata RPCs, fs and S3 ObjectStore drivers, BFF streaming routes, image re-encoding, PDF attachments, stale/orphan cleanup, and profile/deal UI. Added RustFS-backed S3 contract coverage to CI. R2 credentials are not required for the S3-compatible implementation; a dedicated bucket token is still needed for a real Cloudflare R2 smoke test. Local pgTAP is blocked by repeat Podman API EOFs; all other local checks listed above pass. UI screenshot evidence is still pending because the app available in the browser is the prior build and Podman could not rebuild the stack.
- CI commit `760d05b` passed pgTAP and the quality/image checks; Compose smoke caught `detect-libc` bundled into the API ESM output and calling unsupported dynamic `require("child_process")`. A local tsup adjustment excludes third-party packages from bundling; final CI verified the fix before merge.
- Commit `5e020ca` keeps production dependencies external to the ESM bundle. PR #17 merged as `b7d967b` after all required checks passed on `c6f7f24`: quality/coverage, gitleaks, pgTAP, RustFS-enabled S3 contract tests, Docker lint/build/Trivy for all images, and clean-clone Compose smoke.
- 2026-10-30: Standardized the PDF upload trigger with the shared secondary control styling. The real file input remains label-accessible and now has a visible focus ring instead of the clipped screen-reader-only focus state. Component test, stylelint, full suite, build, and live app visual review pass; no API, storage, or database changes.
- 2026-10-30: Fixed local uploads that failed because temporary files were staged under `/tmp` and then hard-linked into the mounted storage volume (`EXDEV`). Staging now lives in a private directory beneath the storage root, preserving same-filesystem atomic writes. Avatar validation failures return 415, while storage/database failures remain generic server errors rather than being mislabeled as bad images. Regression tests cover the cross-device failure and error mapping. Rebuilt local Compose and verified successful PNG profile-photo and PDF deal-attachment uploads end to end; current evidence is in `docs/evidence/ui/`.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
- The CI S3 contract test uses RustFS. A real Cloudflare R2 object round trip passed on 2026-10-31 using a unique object under the configured prefix in the documented project bucket. The app runtime remains configured for filesystem storage. The project UI pass also reviewed avatar and PDF upload controls; the saved screenshot set focuses on dashboard, Board, activity, alert settings, and roles.

- 2026-10-31: ran a scoped Cloudflare R2 smoke against the documented `deal-pipeline-tracker` bucket with a unique temporary object under the configured object prefix; PUT, GET byte comparison, DELETE, and post-delete absence all passed. No credentials were printed or modified. Runtime remains on the filesystem driver.
