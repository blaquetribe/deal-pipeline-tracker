# Handoff

Keep this current. Anyone (human or agent) should be able to continue from here without the chat history.

## Current state
- **Repo:** private GitHub repository `blaquetribe/deal-pipeline-tracker`, default branch `main`. PR #12 merged at `ae144ce`; current checkout is `feat/04-approvals`, based on that merge commit. Feature 04 core IC approval work is uncommitted in this checkout; see `docs/features/04-approvals/progress.md` and ADR 0017.
- **Feature 00 (foundation) is done and merged:** parts 1 and 2a (tooling, design layer, Dockerfiles, Caddy gateway, CI, AI-review tooling) and part 2b (PR 4: Supabase stack in compose, `migrate` job, `test-db`, spikes, `.claude/`), plus PR 9 (pnpm installed directly instead of Corepack so Node 26 images build). Dependabot PRs 2, 3, 5, 6, 7, 8 are merged after green CI: Node 26, Envoy v1.40.1, Realtime v2.147.1, supabase/postgres 17.11.0.007, PostgREST v16.5.
- **CI is green on GitHub** for all of the above, including `test-db` and the extended smoke test. `publish` has pushed multi-arch images with SBOM and provenance to GHCR.
- **Stack:** db, auth, rest, realtime and Envoy on an internal compose network, plus Mailpit and a one-shot `migrate` job. Only the Caddy gateway publishes a port. Keys derive from `JWT_SECRET` (ADR 0014, `docs/features/00-foundation/supabase-stack.md`, GOTCHAS rows 91-97). Commands: `make test-db`, `make smoke`, `make env`, `make ci-local`.
- **Feature 01:** schema/security slices 1–4 are implemented; see `docs/features/01-schema-security/progress.md` for review debt.
- **Feature 02:** database slices A/B plus account lookup, tenant-choice, pending-invitation and ADR 0011 default migrations are present. API auth/session/invitation/onboarding routes, GoTrue adapter, TLS-capable SMTP mailer, web pages, tenant switcher, pending invitation management and CSP proxy are implemented. Local quality gates, pgTAP (337 assertions), and the full Podman compose smoke test pass. Verification requires manual password sign-in, per ADR 0009's no-magic-link decision.
- **Feature 03:** additive migrations provide tenant-scoped assignments, filtered listing, null-safe optimistic writes, tenant-authorized detail/activity reads, exact bigint activity cursors, and a database-authorized dashboard summary. Session-gated create/list/update/stage/assignment/detail/activity/note APIs and accessible dashboard/detail pages are wired; notes use the append-only ledger and the database remains authoritative. Vitest passes 450 tests; typecheck, lint, stylelint, formatting, and local production build pass; pgTAP passes (408 assertions/21 files); full Podman compose smoke passes. GitHub CI currently fails at repository coverage thresholds: all tests pass, but coverage is 68.15% overall and 86.95% statements for `apps/api/src`; CI skips its build step after that failure. Most uncovered code is in existing auth and onboarding surfaces included in this branch. Captured dashboard and detail evidence. Kanban is extended/deferred by ADR 0009; retain keyboard movement and target smooth 60 fps if adding drag-and-drop. Server alert delivery depends on the planned notification/realtime/email slices. See `docs/features/03-deals-core/progress.md`.

## Next action
Feature 04 has the core IC quorum path implemented locally (migrations 15–17, API, deal-detail UI). Vitest (460 tests), pgTAP (450 assertions), typecheck, lint, stylelint, format and production build pass. `pnpm test:coverage` still fails on this clean-main branch until PR #13's coverage tests are merged. A dashboard/detail screenshot was captured from the rebuilt local stack; approval-state interactions are covered in component tests, but we left the seeded deal unchanged rather than create append-only stage history just for a screenshot. Do not claim GitHub CI green: PR #13 is open and its latest run fails Trivy on the upstream Caddy binary's `CVE-2026-116587` (go-jose v4.1.5; fixed upstream in v4.1.6). The core approval follow-up still needs absence/reassignment and scoped delegation before Feature 04 is complete; a deactivated approver can otherwise block the request, which is fail-closed. Kanban remains extended/deferred; future drag-and-drop should target smooth 60 fps and preserve keyboard movement.

## Where decisions live
- `docs/decisions/README.md`: index of ADRs 0001-0014, one line each with the reason. ADRs are append-only; later ones supersede earlier ones (for example ADR 0003's CSS Modules choice was superseded by ADR 0006).
- `docs/brief/GOTCHAS.md`: the brief's traps and the ones found while building (rows 1-100).
- `docs/standards/`: engineering (org base), coding (project overlay with exceptions E1-E12), security, markup, testing, container.
- `docs/design/mockup-review.md`, `docs/features/03-deals-core/closing-soon.md`, `docs/features/02-auth-onboarding/onboarding-flow.md`, `docs/PRESENTATION_NOTES.md`, `docs/AI_USAGE.md`.

## Open questions and owner actions
- **Owner action (enables the advisory AI PR review):** create a Cloudflare API token from the Workers AI template, then set repo secrets `AI_REVIEW_CF_ACCOUNT_ID` and `AI_REVIEW_CF_API_TOKEN` and create the label `ai-review` (commands in `.github/ai-review/README.md`). Until then the workflow runs and skips. Never paste the token into chat.
- **Owner action (R2, needed for feature 08's s3 driver):** the bucket `deal-pipeline-tracker` exists with `Dev/` and `Prod/` folders. The key pair now in the untracked `.env` appears to come from another project (an earlier version of the file named a different bucket), so create a **dedicated Object Read & Write token scoped to this bucket**, and consider a **separate production bucket** (tokens cannot be scoped to a folder). If there is any chance the existing pair was exposed, rotate it: its values were displayed in this working session's tool output. Never commit them; `.env` is gitignored and the template is guarded.
- **To verify when building:** RLS-filtered Realtime for a real user's JWT held by the API (the mechanism is verified with the anon key), which init SQL and gateway config the trimmed Supabase stack needs, the time-zone library for the closing-soon countdown, `sharp` on Alpine and arm64, the R2 region value (`auto`), and behaviour under Docker Desktop and amd64. Verified now: `pg_cron`, `pgcrypto`, `pgTAP` are available.
- Settled: the closing-soon design (ADR 0011), the 60-day window, the UI cut list (ADR 0009).
- Hosting beyond docker compose: none required by the brief. Stretch extraction: undecided (provider, data exposure).
- **Brief receipt date and submission deadline: not recorded yet.** Add here.

## Known issues and limits
- **Vendored Supabase files are stale relative to the images.** `supabase/gateway` and `supabase/db` come from supabase/supabase commit `f4d6d90`; the images have since moved (postgres 17.11.0.007, PostgREST v16.5, Realtime v2.147.1, Envoy v1.40.1). Green CI is evidence they work, not proof of full compatibility. Release notes for the Postgres and PostgREST bumps were not read at the time (see `docs/features/00-foundation/supabase-stack.md`, "Image bumps"). Re-vendor with `make vendor-supabase UPSTREAM=<checkout>` and review the diff.
- **Unverified:** Docker Desktop, Trivy on the third-party Supabase images, memory under load, Claude Code loading the `.claude/` hook and commands (the hook was only simulated).
- Feature 02 currently has process-local single-flight refresh only; multi-instance refresh coordination is not implemented. SMTP now supports explicit implicit-TLS or required-STARTTLS relays with paired credentials; Mailpit remains the local no-auth default. A production relay and certificate chain still need environment-level verification.
- **Wired but unused:** RustFS (`rustfs/rustfs:1.0.1`) as the S3-compatible container for CI `ObjectStore` tests (feature 08).
- `.trivyignore.yaml` holds four documented exceptions for Go-stdlib CVEs in the upstream Caddy binary; they **expire 2026-11-30**, after which the Trivy scan fails until the image is rebuilt upstream or the entries are renewed.
- No branch protection: GitHub does not offer it for private repositories without Pro, so CI cannot be made mandatory. Mention in the README.
- oxfmt is beta (its CSS formatter lowercased font names); the revisit triggers are in ADR 0005.
- Local container checks ran on Podman (no BuildKit, arm64 only); CI is real Docker on amd64. Docker Desktop on a reviewer's machine is untested.
- The AI review has not run live yet (needs the secrets above); review quality from a free model is unproven.

## How to resume
1. Read `AGENTS.md`, `docs/PROGRESS.md`, this file, then the active feature's `progress.md`.
2. `make help` lists every developer command; `make check` runs all quality gates; `make ci-local` approximates all of CI.
3. Update this file and `docs/PROGRESS.md` at the end of every session.
