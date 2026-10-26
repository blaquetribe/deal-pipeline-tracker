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
| 07 | Stretch: document extraction | `docs/features/07-stretch-extraction` | stretch | 03 | not started |

## Cut list (if time runs out, in this order)
1. Presence (05)
2. SLA escalation notification (04)
3. Delegation UI (04) - keep schema/API
4. Custom role editor (04) - system roles only
5. Stretch (07)

Anything cut must be written in the README "what I'd do next" section.

## Log
- Planning complete; docs scaffold created. No application code yet.
- ADR 0002 and 0003 written; org engineering standards adopted with a project overlay; markup, testing and container standards added; GOTCHAS and security standards synced.
