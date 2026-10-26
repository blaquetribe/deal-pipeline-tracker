# ADR 0004: CSP and security headers, object storage, BFF

Status: accepted. Detail: `docs/standards/SECURITY_STANDARDS.md` (sections "Browser security headers and CSP" and "Files and object storage").

## Decisions
1. **BFF:** the Hono service is the Backend-for-Frontend. The browser talks to web assets and to the BFF through the gateway, nothing else. The BFF holds all Supabase and storage credentials.
2. **CSP:** nonce-based policy set by Next middleware for pages (strict-dynamic, no `unsafe-inline`; `unsafe-eval` in dev only); locked-down policy on API responses; static hardening headers at the gateway. No third-party origins. No CSP report endpoint (avoids an unauthenticated write route); CI headless load catches violations.
3. **Object storage behind one `ObjectStore` port.** Drivers: `fs` (default; compose named volume) and `s3` (Cloudflare R2 via S3 API, config only). Contract tests run against both. R2 is the production target, but the reviewer path never needs credentials.
4. **Buckets and keys:** owner creates a dev bucket and a prod bucket with separate bucket-scoped tokens. Keys: `tenants/{tenant_id}/{kind}/{uuid}`; avatars at `users/{user_id}/avatar/{uuid}` because users belong to many tenants. App refuses to start on an environment/bucket mismatch.
5. **Serving:** streamed through the BFF; no presigned URLs, no public buckets (keeps CSP at `'self'`, keeps the single published port, keeps authorization in one place). Presigned URLs for large files are a next step.
6. **Authorization:** a tenant-scoped `files` table with RLS is the source of truth; pending/ready states; content-addressed objects, never overwritten.
7. **Avatars:** initials by default (deterministic, AA contrast); optional upload re-encoded with sharp to 256x256 WebP, EXIF stripped, PNG/JPEG/WebP only. Visible only to users who share a tenant. No Gravatar. Tenant logos are out of scope.
8. **Tiering:** CSP and headers are core security (not cuttable). Storage port + `fs` driver + avatars are extended. The R2 driver is the first extended item cut after presence.

## To verify
- `sharp` builds and runs on the chosen Alpine and arm64 images (else use a glibc slim base).
- `'self'` versus explicit origin for `ws:`/`wss:` in `connect-src` across browsers.
- Next.js nonce handling with the pinned version.
- R2 object lock/retention availability and default encryption at rest.
- Which S3-compatible container to use for the CI contract tests (MinIO distribution has changed; alternatives exist).

## Update 2026-10-26: the owner's R2 layout and the configuration pattern
- **One bucket, two prefixes.** The owner created a single bucket, `deal-pipeline-tracker`, with `Dev/` and `Prod/` folders (key prefixes), replacing the earlier two-bucket assumption. Keys become `{Env}/tenants/{tenant_id}/{kind}/{uuid}` and `{Env}/users/{user_id}/avatar/{uuid}` (`Dev` or `Prod`, capitalised as created; keys are case-sensitive).
- **Consequence for isolation:** R2 API tokens are scoped to buckets, not key prefixes (Cloudflare's token page describes bucket-level scoping only), so a development credential can read and write `Prod/`. Mitigations: the `ObjectStore` always prepends the configured prefix and never accepts one from a caller; the app refuses to start when the prefix and the environment disagree; each environment has its own token; and a **separate production bucket is the recommended hardening** (the owner's call).
- **Configuration pattern: the generic `STORAGE_*` names** (endpoint without the bucket, region, bucket, key prefix, force-path-style, access key pair), chosen over the Cloudflare-named `CF_*` set because the `s3` driver must work with R2 in production and with a local S3-compatible container in CI. The `CF_*` set also carried `CF_PUBLIC_ACCESS_URL`, a **public `r2.dev` URL**, which is rejected: files are only ever streamed through the BFF (this ADR, decision 5), and a public bucket would bypass authorisation and the CSP. A bucket-**name** prefix (`ds-dev-`) inherited from another project becomes an object-**key** prefix (`Dev/`).
- **Region:** R2's S3 API normally uses `auto`; Cloudflare's token page does not state a region, and `WEUR` in the owner's file is a location hint, not an S3 region. **Verify in the storage spike.**
- **Credentials:** a dedicated Object Read & Write token for this project, scoped to this bucket; real values only in the untracked `.env` and CI secrets. The key pair found in the working tree appeared to belong to another project (an earlier version named a different bucket), so create a new one.
- **Incident and guard:** real-looking credentials were found in the tracked `.env.example` working-tree file. They were never staged, committed or pushed (verified). They were moved to a gitignored, mode-600 `.env`, and the template now holds placeholders only. `scripts/check-env-example.mjs` (lint-staged, CI and `make env-check`) fails any commit or CI run that puts a secret in the template; it reports names and line numbers, never values.
