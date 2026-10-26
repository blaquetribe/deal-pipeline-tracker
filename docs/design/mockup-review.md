# UI mockup review (inspiration, not specification)

**Source:** one composite image supplied by the owner: sign-in, dashboard, deal list, deal detail, activity and audit trail, mobile view, style guide. It is **not stored in the repo**: it carries CVC branding and a photograph, and it has AI-image artefacts (garbled labels such as "Owners/Clocks", overlapping text), so its text is not treated as requirements. Decisions are in [ADR 0009](../decisions/0009-ui-direction-from-mockup.md).

Every item below is classified **Adopt**, **Adapt**, **Reject** or **Missing** (needed by us but absent from the mockup), with the reason.

## Adopt (as shown)
| Element | Why |
|---|---|
| Left navigation + top bar (global search, notifications, user menu) | Familiar, scales to our pages. |
| Dashboard: KPI row and "pipeline overview" by stage with counts and totals | This is the brief's "state of the whole pipeline at a glance". |
| Deal list with stage tabs and counts, search and filters, table columns (company, sector, stage, size, target close, owner, last activity) | Maps 1:1 to our deal model. Filters live in URL params; server-side pagination and sort. |
| Deal detail with tabs; Overview with key information and investment thesis | Our model has these fields. Edits write `field_change` events to the ledger. |
| **Activity and audit trail** timeline with a type filter and search; entry types note, stage change, IC decision; each attributed | Direct match for the immutable `deal_events` ledger. |
| Mobile: one stage at a time behind a stage selector | Better than a seven-column horizontal scroll, and keyboard/screen-reader friendly. |
| Stage shown as dot **plus text**, badges with text | Status is never colour alone (our markup standard). |

## Adapt (use the idea, change the execution)
| Element | Change and reason |
|---|---|
| **Palette** (navy #0B1F3B, blue #2563EB, gold #D4AF37, green #10B981, slate, gray, light) | Measured contrast: navy on white 16.5:1, blue on white 5.17:1, slate on white 4.76:1 pass. **Fail AA:** gold text on white 2.10:1, white on gold 2.10:1, green text or white-on-green badge 2.54:1, gray placeholder text 2.56:1, and the light border is 1.23:1 (UI component borders need 3:1). Use gold only as a background with navy text (7.84:1). Derive darker text variants (`-fg` tokens) for green and gold and darker input borders, and let the existing contrast test enforce it. |
| **Typography:** Fraunces headings, Inter body | Both are OFL-licensed variable fonts on npm (`@fontsource-variable/*` 5.3.0). Self-host through the packages, not Google Fonts: offline Docker builds, CSP `font-src 'self'`, no third-party request. Fraunces for page titles only. |
| **Dark navy sidebar** | Add `chrome` semantic tokens (sidebar background/foreground/active) to `packages/ui`; navy primitives added to `tokens.css`; brand blue already ~#2563EB in our tokens. |
| **Currency totals** ("£6.3B total pipeline", donut, "£1.28 total value") | The mockup sums mixed deals into one figure. We show **per-currency** totals (a currency selector or one figure per currency); no cross-currency sum without FX. The donut gets a text table alternative. |
| **"Closing soon: next 60 days"** | Default window becomes **60 days** (was 30); configurable per tenant. |
| **KPI deltas** ("+3 from last month", "25% of pipeline") | Derived from the ledger (created and stage-change events), not stored counters. |
| **"Status" filter** | Ambiguous next to Stage. Replace with filters that mean something to us: Needs my approval, Overdue close date, Owner. |
| **Kanban cards** with drag-and-drop | Drag is an enhancement. Every card has a "Move to..." menu (keyboard and screen reader). Moves that need approval open an approval request instead of moving. |
| **Company logos** | Generated monogram tiles. No external logo services (privacy, CSP, licensing). |
| **Timeline** | Add an integrity cue ("chain verified"), amendment links to the original, **no edit or delete affordance**, exact timestamp with timezone on hover. Relative times ("4 hours ago") render on the client to avoid hydration mismatch. |
| **Sign-in screen** | Keep email and password plus "Forgot password?". Left panel becomes a CSS gradient with neutral copy (no photograph). |
| **Actions menu** on the deal | Shows only the transitions the user may perform, with disabled items explaining why (role, missing required fields, approval pending). |
| **Notification bell** | Becomes the approvals and invitations inbox (realtime), minimal at first. |

## Reject
| Element | Reason |
|---|---|
| CVC logo, wordmark, tagline, Table Mountain photograph | Not ours to reproduce: trademark and impersonation concern, image licensing unknown. Neutral product name and wordmark. Brand tokens stay swappable. |
| "Continue with SSO" | No identity provider exists; a dead button is dishonest UI. Listed under next steps. |
| "Magic link" tab | The brief says pick one method. Email and password with verification is decided (ADR 0001); two methods double the auth surface. |
| Calendar and Reports pages | Not in the brief; cut list. "Closing soon" on the dashboard covers the need. |
| "Next steps" task checklist | Mutable task data outside the brief with no audit story. Deferred. |
| Financials tab | Out of scope. |
| Photographs of people | Avatars are initials; optional upload is feature 08 (extended). |
| Documents tab (as core) | Depends on file storage (feature 08, extended). Shown only when that lands. |

## Missing from the mockup (we need these)
- **Tenant switcher** and organisation name in the header; the user's role shown per tenant.
- **Sign-up, verify-email, onboarding stepper, accept-invitation** screens (see `onboarding-flow.md`).
- **Password reset** ("Forgot password?" is shown but nothing designs it): a token flow like verification. New requirement for feature 02.
- **Approvals UI:** request, decide, quorum progress, rejected-counts-against-quorum, absence and delegation, approval inbox.
- **People page:** members, roles, pending invitations (resend/revoke), absence status.
- **Settings:** closing-soon window, default currency, time zone, custom roles (Owner).
- **Empty, loading and error states**; realtime "reconnecting" status; presence.
- **Required fields per stage** in deal create/edit forms.
- **Dark theme** (tokens exist; the mockup is light only): low priority.
- **Accessibility:** focus order, keyboard paths, live-region announcements.

## Tiering this gives us
- **Core:** sign-in, sign-up, verify, onboarding, Dashboard, Deals list, Deal detail (Overview and Activity), People.
- **Extended:** Pipeline kanban page, Approvals UI, Documents tab, avatar upload.
- **Cut:** Calendar, Reports, Next steps, Financials, SSO, Magic link.

## Mockup inconsistencies worth knowing
- Seven stage colours with near-duplicates (Sourcing and Screening both blue, Signed and Closed both green): the text label carries the meaning, so keep it.
- The donut omits Passed and shows one currency symbol for all deals.
- Row actions ("...") need an accessible name; filters and tabs need real `tablist`/`combobox` semantics.
