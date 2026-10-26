# Container Standards (Dockerfiles, compose, CI image builds)

Goal: `docker compose up` on a clean machine yields a working, seeded system; images are small, reproducible, non-root, scanned, and built in CI. Security rules in SECURITY_STANDARDS take precedence.

## 1. Dockerfiles
One Dockerfile per deployable app: `apps/web/Dockerfile`, `apps/api/Dockerfile`. The gateway uses a pinned stock image (Caddy or nginx) with a committed config. Migrate/seed run from a pinned tooling image or an `api` image target (decided in feature 00).

- **Build context is the repo root** (monorepo, shared package), with a strict `.dockerignore` (node_modules, .git, .env*, docs, tests, build output).
- **Multi-stage**: `deps` -> `build` -> `runtime`. Runtime contains only production dependencies and build output.
- **Pinned bases**: Node LTS by exact tag and digest (e.g. `node:<lts>-alpine@sha256:...`), updated by Dependabot. pnpm via Corepack at a pinned version. `pnpm install --frozen-lockfile`.
- **Cache-friendly order**: copy lockfile and manifests first, install, then copy source. Use BuildKit cache mounts for the pnpm store.
- **web**: Next.js `output: "standalone"`; copy only `.next/standalone`, `.next/static`, `public`. `NEXT_PUBLIC_*` must contain no secrets (and the web app needs no Supabase values at all).
- **api**: compiled JS only; no TypeScript toolchain in runtime. Native modules (`sharp`) must build and run on the chosen base for amd64 and arm64; otherwise use a glibc slim base (verify in the foundation spike).
- **Non-root**: `USER node` (or dedicated uid); files owned accordingly; read-only root filesystem where feasible with explicit writable tmp.
- **Signals**: run with an init (`tini`/compose `init: true`); handle SIGTERM with graceful shutdown (close HTTP server, WebSockets, DB connections).
- **No secrets** in `ARG`, `ENV`, or layers. Build-time secrets via BuildKit `--mount=type=secret`. Runtime config via environment from compose/CI.
- `NODE_ENV=production`; OCI labels (`org.opencontainers.image.source`, `revision`, `created`); `HEALTHCHECK` or compose healthcheck hitting a data-free `/health`.
- Lint every Dockerfile with **hadolint** in CI.

## 2. Compose
- Only the **gateway** publishes a host port. Networks: `edge` (gateway, web, api) and `internal` (api, Supabase services, Mailpit, migrate). Supabase Studio/Kong/PostgREST/Realtime/Postgres are never published.
- Pinned image tags (digests for the bases we control) for every service; multi-arch (amd64 + arm64) must work.
- Startup order by health, not sleep: `depends_on: condition: service_healthy`; `migrate` and `seed` are one-shot (`restart: "no"`, dependents wait on `service_completed_successfully`). Seed is idempotent and gated by a dev flag.
- `.env.example` committed with obviously fake, dev-only values; compose has working defaults so no manual `.env` step is required for the reviewer path. Real secrets are never committed.
- Named volumes: Postgres data, and the `fs` file store (`/data/files`, mounted only into the api container). Document `docker compose down -v` to reset. Storage credentials for R2 are optional env vars, never in `.env.example` values.
- `docker compose config` is validated in CI. Document RAM/disk needs and first-run time in the README.

## 3. CI: docker build step
Job `docker` (needs `test` jobs green), GitHub Actions, least-privilege `permissions`, actions pinned to commit SHAs (Dependabot updates them):

1. Checkout; `hadolint` on all Dockerfiles; `docker compose config -q`.
2. Set up Buildx; **build `web` and `api` images** (matrix) with `docker/build-push-action`, build context repo root, `cache-from/to: type=gha`.
   - Pull requests: build only (`push: false`, `load: true`), single arch (amd64) for speed.
   - `main` and version tags: multi-arch `linux/amd64,linux/arm64` (QEMU), **push to GHCR** with `GITHUB_TOKEN` (`packages: write`), tags `sha-<short>`, semver on tags, `latest` on main; provenance and SBOM attestations on.
3. **Scan** each built image with Trivy; fail on HIGH/CRITICAL fixed vulnerabilities (documented, expiring ignore file only).
4. **Compose smoke** on PRs: `docker compose build`, `docker compose up --wait`, run `scripts/compose-smoke` (sign in as the seeded user through the gateway, seeded deals visible, `/ws` connects, only the gateway port is published), then `docker compose down -v`. Upload logs on failure.
5. Secret scan (gitleaks or equivalent) runs in the same workflow.

CD scope (ADR 0002/0003): CI builds and pushes images; **no hosted deployment**. The live-database path is `supabase db push` from migrations only, documented in the README.

## 4. Checklist (PRs touching Docker/compose/CI)
- [ ] Multi-stage, pinned base, non-root, no secrets in layers
- [ ] hadolint clean; image builds on amd64 and arm64
- [ ] No new published host port (only the gateway)
- [ ] Health checks and ordered startup; clean-clone path still works
- [ ] CI docker job green (build, scan, smoke)
