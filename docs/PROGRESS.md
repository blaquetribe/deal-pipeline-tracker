# Feature Progress

Status: `not started` | `in progress` | `blocked` | `done` | `cut`
Tier: **core** (must ship), **extended** (ship if time allows, else README note), **stretch**.

| # | Feature | Folder | Tier | Depends on | Status |
|---|---|---|---|---|---|
| 00 | Foundation: monorepo, tooling, compose, CI | `docs/features/00-foundation` | core | none | done (merged; CI green including `test-db` and the extended smoke test) |
| 01 | Schema and security: tenants, memberships, permissions, roles, deals, notes, RLS, immutability, SQL tests | `docs/features/01-schema-security` | core | 00 | in progress (slices 1–4 implemented and documented; ready for review) |
| 02 | Auth and onboarding: sign-up, verification, login, sessions, tenant switcher, invitations, Mailer | `docs/features/02-auth-onboarding` | core | 01 | in progress (core implementation verified locally; follow-up scope documented) |
| 03 | Deals core: CRUD, stage machine, notes, pipeline overview, closing soon | `docs/features/03-deals-core` | core | 01, 02 | in progress (create/list/stage/assignment/update/detail/activity/notes and closing-soon dashboard implemented; server alerts depend on features 02 and 05; Kanban is extended/deferred) |
| 04 | Approvals: gates, quorum, decisions, absence, delegation, custom roles + SoD | `docs/features/04-approvals` | extended | 03 | in progress (core IC gate implemented; see deferred absence/delegation/custom roles) |
| 05 | Realtime: WebSocket relay, live cache updates, presence | `docs/features/05-realtime` | core (user requirement) | 03 | done (PR #15 merged after all required CI checks passed; presence remains cut-list scope) |
| 06 | Seed and polish: two tenants, all roles, sample deals, README | `docs/features/06-seed-polish` | core | 03-05 | in progress (seed job, restricted database function, README and reviewer smoke path implemented; fresh full smoke verification in progress) |
| 07 | Stretch: document extraction | `docs/features/07-stretch-extraction` | stretch | 03, 08 | not started |
| 08 | Storage and avatars: ObjectStore port (fs + R2), files table, BFF-proxied files, avatars | `docs/features/08-storage-avatars` | extended | 02, 03 | not started |

CSP and security headers are **core** security work, scheduled in 00 (gateway, Hono headers) and 02 (nonce CSP in Next middleware); they are not on the cut list.

## Cut list (if time runs out, in this order)
1. Presence (05)
2. R2 driver (08) - keep the `fs` driver and the port
3. Avatar upload (08) - keep generated initials
4. SLA escalation notification (04)
5. Delegation UI (04) - keep schema/API
6. Custom role editor (04) - system roles only
7. Stretch (07)

Not planned (mockup review, ADR 0009): Calendar and Reports pages, Next-steps checklist, Financials tab, SSO, Magic link.

Anything cut must be written in the README "what I'd do next" section.

## Log
- Planning complete; docs scaffold created. No application code yet.
- ADR 0002 and 0003 written; org engineering standards adopted with a project overlay; markup, testing and container standards added; GOTCHAS and security standards synced.
- ADR 0005-0007: oxlint/oxfmt + hooks, Tailwind + `packages/ui` design layer, TanStack Query kept over alova; onboarding flow designed (feature 02).
- ADR 0008: Dockerfiles, Caddy gateway, hardened compose, smoke test and CI written and verified locally on Podman; the workflow has not run on GitHub.
- First CI run on PR #1 green (every job; publish skipped by design).
- PR #1 merged (`29eb2c7`); the publish job on main was green: 3 images, amd64 and arm64, SBOM and provenance, pushed to GHCR (ADR 0008 update).
- Feature 01 schema/security slices 1–4 are implemented; `docs/features/01-schema-security/progress.md` records the remaining review/debt items.
- Feature 02 auth/onboarding implementation on `feat/02-api-auth` passes local typecheck, lint, style, formatting, 405 Vitest tests, Webpack production build, 337 pgTAP assertions and the Podman compose smoke suite. Onboarding routes follow the database-selected step; email verification is followed by password sign-in in keeping with ADR 0009's no-magic-link decision. SMTP supports TLS/authenticated relays while preserving Mailpit defaults. See the feature progress file for remaining limitations.
- Feature 03 is underway in the preserved feature 02 checkout: tenant-scoped create/list/stage/assignment/update/detail/activity APIs, accessible dashboard controls, ordered activity timeline, older-event pagination, append-only notes and the tenant-time-zone closing-soon dashboard are implemented. Latest local checks pass (450 Vitest tests, typecheck, lint, stylelint, format and build); pgTAP passes (408 assertions across 21 files); full Podman compose smoke passes. Captured dashboard evidence showing a deal due in 12 days, alongside earlier detail evidence. Server alert delivery depends on features 02 and 05. Kanban is extended/deferred and future drag-and-drop should target smooth 60 fps while retaining keyboard movement. See `docs/features/03-deals-core/progress.md`.
- Coverage implemented (ADR 0012); env-template secret guard added after real-looking R2 credentials appeared in the tracked `.env.example` working tree (never staged or pushed; moved to the gitignored `.env`); owner's R2 layout recorded (ADR 0004 update); Supabase stack measured and trimmed design decided (ADR 0013).
- AI PR review: GitHub Models found retired (ADR 0010 corrected); advisory review built on Cloudflare Workers AI with 30 offline tests, shellcheck and actionlint clean; live run pending the owner's secrets.
- Closing soon designed and confirmed by the owner (ADR 0011): live countdown with hours on the final day, 60-day window, alerts at 5 days, 1 day and overdue to the assigned team, in-app plus email digest with deal details and link; design in `docs/features/03-deals-core/closing-soon.md`.
- Mockup reviewed (ADR 0009); AI PR-review options researched (ADR 0010, proposed); Makefile added; PR #1 opened to trigger the first CI run.
- Feature 00 part 2b merged (PR 4, ADR 0014: Supabase stack in compose, `test-db`, spikes). PR 9: pnpm installed directly so Node 26 images build. Dependabot bumps merged after green CI: Node 26, Envoy v1.40.1, Realtime v2.147.1, supabase/postgres 17.11.0.007, PostgREST v16.5. Open: vendored Supabase files still at `f4d6d90`.
- 2026-10-28: PR #12 merged to `main` as `ae144ce`. Coverage follow-up passes 502 Vitest tests, typecheck, lint, stylelint, format and build checks. Global and API/shared coverage gates pass locally, including global branch coverage at 85.04%. GitHub CI for the follow-up PR remains to be verified. An invalid onboarding skip step now returns a safe 400 instead of an internal error; see feature 02/03 progress and the current `docs/HANDOFF.md`.
- PR #13 now rebuilds upstream Caddy v2.11.7 with go-jose v4.1.6 and x/net v0.60.0 using a digest-pinned official builder; see ADR 0017. Local pinned Trivy scan, hadolint, Caddyfile validation and isolated compose smoke pass. GitHub quality, secret, web/API image, pgTAP and gateway checks pass; compose smoke is pending. PR #14 includes PR #13's latest base with coverage and approval tests preserved; combined local checks pass (520 tests, typecheck, 85.02% global branch coverage). Keep both PRs open until all required GitHub checks pass.
- Feature 04 core IC approvals are implemented on `feat/04-approvals`; see ADR 0018 and `docs/features/04-approvals/progress.md`. PR #14 includes the coverage tests from PR #13 as its base.
- 2026-10-28: PR #13 merged to `main` as `1bfe752`; PR #14 merged as `e1fd24c` after all required CI checks passed. Local main was fast-forwarded to `origin/main`, verified clean, and `feat/05-realtime` was created from it. Feature 05 is in progress; see its progress file.
- 2026-10-29: PR #15 merged to `main` as `795cc91` after all required CI checks passed. Feature 06 is implemented on `feat/06-seed-polish`, with PR #16 open and all required checks green, including the clean-clone Compose smoke. The first run found a notification test counting alerts from seeded deals; fixture isolation is fixed. Details are in `docs/features/06-seed-polish/progress.md`.
