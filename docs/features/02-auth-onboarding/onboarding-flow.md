# Registration onboarding: design

Status: design (no code yet). Owner feature: `02-auth-onboarding`. Covers the first-time **Owner** flow and the shorter **invitee** flow.

## Principles
- **Server-driven.** The BFF owns the state machine; the UI renders the current step. Hitting a later URL directly cannot skip a required step.
- **Nothing exists before verification.** No tenant and no business data are created until the email is verified (anti-squatting; GOTCHAS 11/29). The organisation name is collected after verification, not at sign-up.
- **Resumable.** Progress is stored per user; closing the tab and signing in later returns to the right step.
- **Short.** Required steps are only those that make the account usable. Everything else is skippable and shown as a checklist on the dashboard.
- **Accessible.** A stepper (`ol` with `aria-current="step"`), one route per step, focus moves to the step heading on change, an error summary on failed submit, no timed interactions.

## Owner flow (public sign-up)
| # | Step | Required | What happens |
|---|---|---|---|
| 1 | **Create account** | yes | Email, password (12+ chars), full name. Supabase user created with `email_confirm: false`. Generic response whether or not the email exists; rate-limited. |
| 2 | **Verify email** | yes | "Check your inbox" page (masked email, resend with cooldown, change email restarts). Link carries a single-use hashed token (24h). Consuming it flips `email_confirm`, signs the user in, creates the onboarding record. |
| 3 | **Your profile** | yes (name prefilled) | Display name, job title. Avatar defaults to generated initials; upload is optional (feature 08, extended). |
| 4 | **Create your organisation** | yes | Organisation name, time zone (default `Africa/Johannesburg`), default currency (default `ZAR`). One transaction creates the tenant, the Owner membership, seeded system roles and default settings. Allowed **once per user** (users cannot create further tenants). |
| 5 | **Pipeline defaults** | no (skippable) | Confirm the fixed stages, the "closing soon" window (default 30 days) and which stage gates need approval. Approval quorum cannot be set meaningfully until there are members, so it defaults and is flagged on the checklist. |
| 6 | **Invite your team** | no (skippable) | Emails and a role per row, from system roles at or below Owner. Rate-limited, capped per tenant, shows pending invitations. |
| 7 | **Done** | n/a | Lands on the pipeline with a checklist: add first deal, invite team (if skipped), set approval quorum, upload an avatar. |

## Invitee flow (arrives via invitation link)
1. Open the link (token validated: unexpired, unused, bound to the invited email).
2. **New user:** set password and name. **Existing user:** sign in as the invited email (mismatch is refused).
3. Profile step (name prefilled).
4. Accept: membership created in a single transaction (token consumed atomically), land in that tenant. **No organisation step.**

## Data (migration in feature 01/02)
- `profiles(user_id, display_name, job_title, avatar_file_id)`.
- `onboarding_progress(user_id, flow, current_step, completed_at, skipped_steps)`; `flow` is `owner` or `invitee`.
- Tenant settings: `timezone`, `default_currency`, `closing_soon_days`.
- All writes via DB functions (ADR 0002); `create_organisation` checks the caller is verified, has no owned tenant, and is in the `owner` flow.

## API (Hono BFF; all validated with zod from `packages/shared`)
`POST /auth/signup`, `POST /auth/verify`, `POST /auth/resend`, `GET /onboarding/state`, `PUT /onboarding/profile`, `POST /onboarding/organisation`, `PUT /onboarding/defaults`, `POST /onboarding/invitations`, `POST /onboarding/skip/:step`, `POST /onboarding/complete`. Everything except sign-up, verify, resend and login requires a session; the signed-out route sweep keeps the allowlist honest.

## Guards
- Next layout/middleware redirects signed-in users with incomplete onboarding to their current step (UX only). The BFF independently refuses business endpoints until required steps are done.
- Double submit is harmless: org creation and invitation acceptance are idempotent.

## Tests
- State machine (shared fixtures): required steps cannot be skipped, skippable steps can, resume returns the right step, owner-only steps refused for invitees.
- API: unverified user cannot create an organisation; second organisation refused; expired, reused or wrong-email token refused; resend invalidates the previous token; rate limits.
- Component: stepper semantics, focus moves to the heading, error summary links to fields.
- Demo path: sign up, read the email in Mailpit, verify, finish the steps, invite a second user and accept in a private window.

## Open decisions
1. Is "Pipeline defaults" (step 5) worth the screen, or should defaults apply silently and live in settings only? Recommendation: keep it, skippable; it is where we explain the stages and approvals.
2. Should the Owner be allowed to defer the profile step? Recommendation: no, the name is needed for the audit ledger's actor snapshot.
