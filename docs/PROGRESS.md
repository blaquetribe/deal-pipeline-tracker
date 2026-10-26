# Feature Progress

Status: `not started` | `in progress` | `blocked` | `done` | `cut`
Tier: **core** (must ship), **extended** (ship if time allows, else README note), **stretch**.

| # | Feature | Folder | Tier | Depends on | Status |
|---|---|---|---|---|---|
| 00 | Foundation: monorepo, tooling, compose, CI | `docs/features/00-foundation` | core | none | not started |
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

Anything cut must be written in the README "what I'd do next" section.

## Log
- Planning complete; docs scaffold created. No application code yet.
- ADR 0002 and 0003 written; org engineering standards adopted with a project overlay; markup, testing and container standards added; GOTCHAS and security standards synced.
