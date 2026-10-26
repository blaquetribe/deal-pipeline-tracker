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
