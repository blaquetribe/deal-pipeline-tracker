# Handoff

Keep this current. Anyone (human or agent) should be able to continue from here without the chat history.

## Current state
- **Repo:** private GitHub repository `blaquetribe/deal-pipeline-tracker`, default branch `main`. The remote is HTTPS; pushes use `gh` credentials. PR #1 is merged (`29eb2c7`). Work continues on `feat/00-foundation-2b`, cut from `main` (the merged `feat/00-foundation` branch can be deleted).
- **Feature 00 parts 1 and 2a are done and merged:** pnpm workspaces, TypeScript 7, oxlint + oxfmt + Stylelint, Vitest (207 tests), Tailwind design layer (`packages/ui`, with the WCAG contrast test), Husky/lint-staged/commitlint hooks, digest-pinned Dockerfiles, Caddy gateway, hardened compose, `scripts/compose-smoke.sh` (17 checks), CI, Dependabot, Makefile, and the advisory AI-review tooling (30 offline tests).
- **CI is verified on GitHub:** PR #1 and the merge to `main` ran green end to end, including `publish`: web, api and gateway images built for `linux/amd64` and `linux/arm64` with SBOM and provenance attestations and pushed to GHCR tagged `latest` and `sha-29eb2c7` (confirmed from the job logs; package visibility and pulling were not independently checked because the local `gh` token lacks `read:packages`).
- **Not built yet:** the Supabase stack, migrations, and every product feature. Design exists for onboarding, the closing-soon countdown and alerts, and the UI direction.

## Next action
`00-foundation` part 2b (see its `progress.md`): Supabase stack in compose (internal network, `migrate` service), a `test-db` CI job, the remaining spikes (WebSocket through the gateway, Realtime with server-held JWTs, `sharp` on Alpine and arm64, an S3-compatible container for CI), and the `.claude/` project hooks. Measure the stack's memory first (the local Podman VM has 4 GiB). Then `01-schema-security`; check in with the owner after the RLS tests pass.

## Where decisions live
- `docs/decisions/README.md`: index of ADRs 0001-0011, one line each with the reason. ADRs are append-only; later ones supersede earlier ones (for example ADR 0003's CSS Modules choice was superseded by ADR 0006).
- `docs/brief/GOTCHAS.md`: the brief's traps and the ones found while building (rows 1-81).
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
- `.trivyignore.yaml` holds four documented exceptions for Go-stdlib CVEs in the upstream Caddy binary; they **expire 2026-11-30**, after which the Trivy scan fails until the image is rebuilt upstream or the entries are renewed.
- No branch protection: GitHub does not offer it for private repositories without Pro, so CI cannot be made mandatory. Mention in the README.
- oxfmt is beta (its CSS formatter lowercased font names); the revisit triggers are in ADR 0005.
- Local container checks ran on Podman (no BuildKit, arm64 only); CI is real Docker on amd64. Docker Desktop on a reviewer's machine is untested.
- The AI review has not run live yet (needs the secrets above); review quality from a free model is unproven.

## How to resume
1. Read `AGENTS.md`, `docs/PROGRESS.md`, this file, then the active feature's `progress.md`.
2. `make help` lists every developer command; `make check` runs all quality gates; `make ci-local` approximates all of CI.
3. Update this file and `docs/PROGRESS.md` at the end of every session.
