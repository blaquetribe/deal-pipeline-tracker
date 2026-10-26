# ADR 0009: UI direction from the supplied mockup, and corrections to earlier notes

Status: accepted. Full analysis: [`docs/design/mockup-review.md`](../design/mockup-review.md).

## Decisions
1. **Use the mockup's information architecture and page set, not its pixels or assets.** Core pages: sign-in/sign-up/verify/onboarding, Dashboard, Deals list, Deal detail (Overview, Activity), People. Extended: Pipeline kanban, Approvals UI, Documents tab. Cut: Calendar, Reports, Next-steps checklist, Financials, SSO, Magic link.
2. **Keep the DoorSprint token architecture (ADR 0006) and re-skin it to the mockup's look:** add navy primitives and `chrome` semantic tokens for the sidebar; keep brand blue; use gold only as a background with navy text; derive text-safe variants for green and gold; darken input borders to 3:1. The WCAG contrast test in `packages/ui` is the gate.
3. **Fonts:** Fraunces (headings) and Inter (body), self-hosted from `@fontsource-variable/*` (OFL-1.1). No Google Fonts requests.
4. **No CVC branding, logo, photograph or tagline.** Neutral product name; brand values live in tokens so they can be swapped.
5. **Honest UI only:** no SSO button without an IdP, no magic-link tab, no fake metrics. Company logos are generated monograms.
6. **Per-currency totals** everywhere money is aggregated; "closing soon" default window **60 days** (tenant-configurable); KPI deltas derived from the ledger.
7. **Accessible equivalents for visual patterns:** "Move to..." for drag-and-drop, a text table for charts, stage dot plus label.
8. **Password reset is added to feature 02** (token flow reusing the hashed single-use token mechanism).

## Corrections to earlier documents (found by reading the docs shipped inside the installed Next.js)
- **In Next 16 the `middleware` convention is called `proxy`** (`proxy.ts`, exported function `proxy`). Wherever our notes say "Next middleware", read "Next `proxy.ts`". The rule is unchanged: it sets headers and redirects for UX and is **never** the authorization boundary; the BFF is.
- **Nonce CSP is confirmed for this version** (from `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`): the proxy generates a per-request nonce and sets the CSP header on the request; Next reads the nonce from that header and applies it automatically to framework scripts, page bundles and inline styles; **pages must be dynamically rendered** (our layout already is, because it reads the theme cookie). This closes the "Next nonce handling" *verify* item as **documented for this version, to be proven by a test in feature 02**.
- **Do not copy `upgrade-insecure-requests` from Next's example** into the local policy: the gateway serves plain HTTP on localhost. Add it only when TLS terminates in front of the gateway.
- Next's own example excludes `/api` from the proxy matcher; our `/api` is the BFF behind the gateway, not a Next route, so nothing changes.

## Dependency-generated agent file
`next dev` writes `apps/web/AGENTS.md` (instructions telling agents to read Next's bundled docs). It is useful advice but it is instructions injected by a dependency into a file agents read, so it is **gitignored** and never committed; our own `AGENTS.md` files are the only authoritative ones. The bundled docs themselves are a trustworthy reference for the installed version.

## Why
The mockup is a good starting point for navigation and information density, but copying it literally would ship accessibility failures (measured), a misleading cross-currency total, a dead SSO button and someone else's brand. Taking the structure and re-deriving the details keeps the demo credible and defensible in front of the team.
