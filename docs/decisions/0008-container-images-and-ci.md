# ADR 0008: Container images, compose topology and CI

Status: accepted (feature 00, part 2a). Implements `docs/standards/CONTAINER_STANDARDS.md`.

## Decisions
1. **One Dockerfile per deployable** (`apps/web`, `apps/api`, `gateway`), repo-root build context, multi-stage (`deps` -> `build` -> `runtime`), base images pinned by digest in **literal `FROM` lines** (an `ARG`-based `FROM` is invisible to Dependabot), numeric non-root user (`USER 1000:1000`), JSON-form `HEALTHCHECK`.
2. **API image ships a single bundled file, no `node_modules`, no pnpm** (tsup `noExternal: [/.*/]`). Smallest runtime surface (172 MB). Switch to `pnpm deploy` when a native module (sharp, feature 08) arrives, because native modules cannot be bundled.
3. **Web image uses Next's `standalone` output**, which keeps the monorepo layout (`apps/web/server.js`). 208 MB.
4. **npm, corepack and yarn are deleted from the runtime images.** Trivy flagged four HIGH CVEs inside npm's own bundled dependencies (`brace-expansion`, `undici`) in the stock Node image. The runtime never needs a package manager, so deleting them removes the findings and the attack surface rather than suppressing them.
5. **Gateway = Caddy** (`admin off`, `auto_https off`, TLS is terminated upstream in production). It sets the hardening headers, drops any client-supplied `x-middleware-subrequest`, serves `/healthz`, strips `/api` before proxying to the BFF, passes `/ws`, and sends everything else to web.
6. **Compose hardening:** `init`, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, tmpfs for `/tmp` and Next's cache, healthchecks gating `depends_on`, only the gateway publishes a host port. An internal network arrives with the Supabase stack.
7. **`scripts/compose-smoke.sh`** is the clean-clone proof (17 checks) and is the same script CI runs. It falls back from `docker compose` to `docker-compose`.
8. **CI (`.github/workflows/ci.yml`):** `quality` (typecheck, lint, stylelint, format, coverage, build, commitlint on PRs), `secrets` (gitleaks), `docker` matrix (hadolint, Buildx build with GHA cache, Trivy), `smoke`, and `publish` (multi-arch, provenance, SBOM, GHCR) **only on main and `v*` tags after every gate is green**. Only first-party GitHub/Docker actions, pinned to commit SHAs; tool images (hadolint, Trivy, gitleaks, actionlint) pinned by digest; least-privilege `permissions`.
9. **Dependabot** for npm, the three Dockerfiles, and GitHub Actions (weekly).

## Why
Each choice shrinks what can go wrong in a financial system's delivery path: fewer packages in the image, no extra privileges, one public port, pinned and reviewable inputs, and a gate that fails closed.

## Things the real run taught us (not obvious from reading)
- **`cap_drop: ALL` made the stock Caddy image unrunnable** (`failed to exec pid1: Operation not permitted`): the upstream binary carries a `cap_net_bind_service` file capability that the kernel refuses once capabilities are dropped. We bind 8080, so the Dockerfile ships a plain copy of the binary. We did not weaken the hardening.
- **tmpfs `uid=`/`gid=` options are not portable** (Podman rejects them); we use the default world-writable tmpfs.
- **Trivy found OS and Go CVEs in the gateway.** Alpine packages (`brotli-libs`, `curl`) were fixed by `apk upgrade`. Four HIGH Go-stdlib CVEs in the upstream Caddy binary have no rebuilt image yet; they are recorded in `.trivyignore.yaml` with reasons, scope and an **expiry of 2026-11-30** so the scan fails again if nobody revisits them. Real exposure is denial of service; production should sit behind a CDN/WAF.
- The smoke test was **proven to fail**: publishing the API port through a temporary override failed both exposure checks.
- gitleaks: 0 findings across history and tracked files. The working-tree scan's 13 hits are random per-build keys in gitignored `.next/` output.

## Verified locally vs. NOT verified
Verified here: all three images build and run; hadolint clean; Trivy clean (with the four documented exceptions); 17 smoke checks pass; negative smoke test; actionlint clean on the workflow; gitleaks.

**Not verified (be honest in the presentation):**
- The local engine is **Podman 6.1.1** behind the Docker CLI, with standalone `docker-compose` 5.5.1 and **no BuildKit/buildx**. So BuildKit-specific behaviour, the `# syntax` line, GHA layer caching and `docker compose` (plugin) have not run here.
- Only **arm64** was built. amd64 and the QEMU multi-arch build are unproven.
- **The workflow has never run on GitHub.** SBOM/provenance attestation, GHCR push permissions and `commitlint --from/--to` ranges are untested until the first push.
- The first CI run is the real verification; expect small fixes.

## Machine note for the README
The dev VM here has 4 GiB RAM. The full Supabase stack (10+ containers) may not fit comfortably; measure before promising "one command on any laptop" and document minimum resources.

## Revisit when
Upstream Caddy publishes a rebuilt image (remove the ignore entries); a native module enters the API (switch to `pnpm deploy`); the first CI run exposes differences between Podman and Docker.

## Update 2026-10-26: first CI run on GitHub (PR #1, run 40302040164)
Ubuntu runners (amd64, real Docker with BuildKit) ran every job green in about three minutes: quality (typecheck, lint, stylelint, format, coverage, build, and commitlint over the PR commit range), gitleaks, hadolint, Buildx build with the GHA cache, Trivy (via the Docker socket), and the compose smoke test (this exercised the `docker compose` plugin branch of the script). `publish` was skipped by design (it runs only on `main` and `v*` tags).

Now verified: amd64, BuildKit, GHA cache, Trivy in CI, commitlint range, the smoke test on a real Docker engine. The same Dockerfiles passed on Podman and on Docker.

**Still unproven:** the `publish` job (QEMU multi-arch build, SBOM and provenance attestations, GHCR push and the `packages: write` permission). It will first run on the merge to `main`; expect small fixes there. Docker Desktop on a reviewer's machine remains untested (Podman locally, Linux Docker in CI).
