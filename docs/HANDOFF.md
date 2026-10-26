# Handoff

Keep this current. Anyone (human or agent) should be able to continue from here without the chat history.

## Current state
- Phase: `00-foundation` parts 1 and 2a done on branch `feat/00-foundation`: tooling, design layer and hooks (committed `7ea7d09`); Dockerfiles for web/api/gateway, hardened compose, `scripts/compose-smoke.sh`, CI workflow and Dependabot (uncommitted). Verified locally: all gates, 207 tests, hadolint, Trivy, 17 smoke checks, actionlint, gitleaks. **CI verified on GitHub: PR #1's first run was green end to end (about 3 min). Still unproven: the `publish` job (multi-arch, SBOM/provenance, GHCR), which only runs on `main` and tags.** No Supabase stack or migrations yet.
- Repo: local only (`git init` done, nothing committed, no GitHub remote). Do not push or create the GitHub repo without the owner's go-ahead.

## Next action
PR #1's CI is green. Next: `00-foundation` part 2b

## Key decisions
See `docs/decisions/0001-architecture.md` and `docs/decisions/0002-gateway-ledger-and-hardening.md` (0002 supersedes parts of 0001). Presentation material: `docs/PRESENTATION_NOTES.md`. `docs/decisions/0003-tooling-and-standards.md` records tooling (Vitest, Dockerfiles, CI docker build, CSS Modules). `GOTCHAS.md` rows 19-40 and the security standards now reflect ADR 0002. Items marked *verify* (Next WS proxying, Next patched version, Realtime with server-held JWTs, Vitest projects syntax, axe package) are unconfirmed until a spike in 00/05. Summary: Next.js UI that knows nothing of Supabase; separate Hono API as sole Supabase client; Supabase CLI migrations; Hono WebSocket relaying RLS-filtered Realtime events; multi-tenant with multi-membership; public sign-up creates Owner; invitations; permission-based RBAC with SoD; k-of-N approvals with absence handling.

## Latest decisions (ADR 0004)
CSP and hardening headers (core); Hono is the BFF; object storage behind an `ObjectStore` port (`fs` default, Cloudflare R2 by config) with a tenant-scoped `files` table, BFF-streamed files and no presigned URLs; avatars = initials plus optional re-encoded upload (feature 08, extended tier).

## Latest decisions (ADR 0005-0007)
oxlint + oxfmt replace ESLint/Prettier (TypeScript unpinned to 7); Husky + lint-staged + commitlint (CI remains the real gate); Tailwind v4 with a `packages/ui` design layer and cookie-driven theme; feature layering by public `index.ts` + lint boundaries (no Nuxt-style layers in Next); TanStack Query kept, alova not adopted (unverified for App Router). Index: `docs/decisions/README.md`. Onboarding design: `docs/features/02-auth-onboarding/onboarding-flow.md`.

## Open questions
- **Owner action (not needed until feature 08's s3 driver):** create the R2 dev bucket and prod bucket, each with its own bucket-scoped API token (object read/write only). Do not commit them; never use the prod bucket from dev.
- Hosting/deploy target beyond docker compose: none required by the brief.
- Stretch extraction: undecided (model/provider, data exposure).
- Brief receipt date / submission deadline: not recorded yet. Add here.

## Known issues
None yet.

## How to resume
1. Read `AGENTS.md`, `docs/PROGRESS.md`, this file, then the active feature's `progress.md`.
2. Run the commands in `AGENTS.md` (populated after 00).
3. Update this file and `docs/PROGRESS.md` at the end of every session.
