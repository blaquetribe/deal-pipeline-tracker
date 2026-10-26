# Feature Progress

Status: `not started` | `in progress` | `blocked` | `done` | `cut`
Tier: **core** (must ship), **extended** (ship if time allows, else README note), **stretch**.

| # | Feature | Folder | Tier | Depends on | Status |
|---|---|---|---|---|---|
| 00 | Foundation: monorepo, tooling, compose, CI | `docs/features/00-foundation` | core | none | in progress (2a done: tooling, design layer, hooks, Dockerfiles, gateway, compose, CI written; 2b next: Supabase stack, `test-db`, spikes, first CI run) |
| 01 | Schema and security: tenants, memberships, permissions, roles, deals, notes, RLS, immutability, SQL tests | `docs/features/01-schema-security` | core | 00 | not started |
| 02 | Auth and onboarding: sign-up, verification, login, sessions, tenant switcher, invitations, Mailer | `docs/features/02-auth-onboarding` | core | 01 | not started |
| 03 | Deals core: CRUD, stage machine, notes, pipeline overview, closing soon | `docs/features/03-deals-core` | core | 01, 02 | not started |
| 04 | Approvals: gates, quorum, decisions, absence, delegation, custom roles + SoD | `docs/features/04-approvals` | extended | 03 | not started |
| 05 | Realtime: WebSocket relay, live cache updates, presence | `docs/features/05-realtime` | core (user requirement) | 03 | not started |
| 06 | Seed and polish: two tenants, all roles, sample deals, README | `docs/features/06-seed-polish` | core | 03-05 | not started |
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
- AI PR review: GitHub Models found retired (ADR 0010 corrected); advisory review built on Cloudflare Workers AI with 30 offline tests, shellcheck and actionlint clean; live run pending the owner's secrets.
- Closing soon designed and confirmed by the owner (ADR 0011): live countdown with hours on the final day, 60-day window, alerts at 5 days, 1 day and overdue to the assigned team, in-app plus email digest with deal details and link; design in `docs/features/03-deals-core/closing-soon.md`.
- Mockup reviewed (ADR 0009); AI PR-review options researched (ADR 0010, proposed); Makefile added; PR #1 opened to trigger the first CI run.
