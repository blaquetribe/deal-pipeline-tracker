# Registration onboarding: design

Status: implemented (manual sign-in after verification follows ADR 0009's no-magic-link decision). Owner feature: `02-auth-onboarding`. Covers the first-time **Owner** flow and the shorter **invitee** flow.

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
| 2 | **Verify email** | yes | "Check your inbox" page (masked email, resend with cooldown, change email restarts). Link carries a single-use hashed token (24h). Consuming it atomically flips `email_confirm` and creates the onboarding record. The user then signs in with their password; the verification link is not a login credential (ADR 0009 excludes magic links). |
| 3 | **Your profile** | yes (name prefilled) | Display name, job title. Avatar defaults to generated initials; upload is optional (feature 08, extended). |
| 4 | **Create your organisation** | yes | Organisation name, time zone (default `Africa/Johannesburg`), default currency (default `ZAR`). One transaction creates the tenant, the Owner membership, seeded system roles and default settings. Allowed **once per user** (users cannot create further tenants). |
| 5 | **Pipeline defaults** | no (skippable) | Confirm the fixed stages, the "closing soon" window (default 60 days per ADR 0011) and which stage gates need approval. Approval quorum cannot be set meaningfully until there are members, so it defaults and is flagged on the checklist. |

| 6 | **Invite your team** | no (skippable) | Emails and a role per row, from system roles at or below Owner. Rate-limited, capped per tenant, shows pending invitations. |
| 7 | **Done** | n/a | Lands on the pipeline with a checklist: add first deal, invite team (if skipped), set approval quorum, upload an avatar. |

## Verification and session boundary

The verification token proves control of the email address and atomically confirms it and starts onboarding in Postgres. It does not establish a session. The user signs in with their password afterward, keeping email verification separate from authentication and honoring ADR 0009's explicit exclusion of magic links. Do not exchange a verification token for a GoTrue session.

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
`POST /auth/signup`, `POST /auth/verify`, `POST /auth/resend`, `POST /auth/login`, `GET /auth/session`, `GET /auth/tenants`, `POST /auth/tenant`, `POST /auth/password-reset`, `POST /auth/password-reset/complete`, `POST /auth/invitations/preview`, `POST /auth/invitations/register`, `POST /auth/invitations/accept`, `GET /onboarding/state`, `PUT /onboarding/profile`, `POST /onboarding/organisation`, `PUT /onboarding/defaults`, `GET /onboarding/invitations`, `POST /onboarding/invitations`, `DELETE /onboarding/invitations`, `POST /onboarding/skip/:step`, `POST /onboarding/complete`. Signed-out registration, verification, resend, login, reset and invitation preview/registration are public; the signed-out route sweep keeps the allowlist honest. Tenant choice reads and switches use the authenticated identity, with membership rechecked by the database when switching.

The onboarding UI shows pending invitations and supports revocation. Step-specific URLs use `/onboarding/profile`, `/onboarding/organisation`, `/onboarding/defaults`, and `/onboarding/invite`. The active step remains database-driven; opening a different step URL redirects to the current step. The `ol` stepper marks the current, completed and skipped steps, focus moves to the active step heading after a transition, and validation errors link to their fields.

## Guards
- Next layout/`proxy.ts` redirects signed-in users with incomplete onboarding to their current step (UX only). The BFF independently refuses business endpoints until required steps are done.
- Double submit is harmless: org creation and invitation acceptance are idempotent.

## Tests
- State machine (shared fixtures): required steps cannot be skipped, skippable steps can, resume returns the right step, owner-only steps refused for invitees.
- API: unverified user cannot create an organisation; second organisation refused; expired, reused or wrong-email token refused; resend invalidates the previous token; rate limits.
- Parity: `packages/shared/fixtures/onboarding-steps.json` is checked against the TS mirror in Vitest and the persisted SQL steps in `15_onboarding_parity.test.sql`.
- Component: stepper semantics, canonical step paths, mismatched-step redirects, and validation-summary focus and links are covered in `onboarding.test.tsx`.
- Demo path: sign up, read the email in Mailpit, verify, finish the steps, invite a second user and accept in a private window.

## Open decisions
1. Is "Pipeline defaults" (step 5) worth the screen, or should defaults apply silently and live in settings only? Recommendation: keep it, skippable; it is where we explain the stages and approvals.
2. Should the Owner be allowed to defer the profile step? Recommendation: no, the name is needed for the audit ledger's actor snapshot.
