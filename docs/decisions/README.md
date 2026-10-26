# Decision index

One line per ADR: what we decided and why. ADRs are never edited after acceptance; a later ADR supersedes. Use this page as the spine of the presentation.

| # | Decision | Why |
|---|---|---|
| [0001](0001-architecture.md) | Monorepo; Next.js UI that knows nothing of Supabase; separate Hono API; multi-tenant; open sign-up creating an Owner; permission-based RBAC; k-of-N approvals | Clear boundaries, security enforced below the UI, matches a financial approval process |
| [0002](0002-gateway-ledger-and-hardening.md) | Gateway as the only published port; rules in Postgres; server-side sessions; one hash-chained `deal_events` ledger | A valid JWT must not bypass rules; audit trail must be tamper-evident |
| [0003](0003-tooling-and-standards.md) | Org engineering standards + project overlay; Vitest; Dockerfiles; CI docker build | Reproducible, explainable quality gates |
| [0004](0004-csp-storage-bff.md) | Nonce-based CSP and hardening headers; Hono is the BFF; `ObjectStore` port (fs + Cloudflare R2); avatars re-encoded | Browser hardening without breaking single-origin; reviewer path needs no cloud account |
| [0005](0005-oxc-toolchain-and-git-hooks.md) | oxlint + oxfmt, TypeScript 7, Husky + lint-staged + commitlint | Removes the TypeScript pin, faster, same rule coverage we need; hooks help but CI decides |
| [0006](0006-tailwind-design-layer.md) | Tailwind v4; DoorSprint tokens in `packages/ui`; cookie theme; feature layering with lint boundaries | Accessible, themeable design system with a tested contrast matrix; strict CSP; Next has no Nuxt-style layers so we use packages + boundaries |
| [0007](0007-request-layer-tanstack-query-vs-alova.md) | Keep TanStack Query; alova not adopted | Our realtime/tenant/optimistic needs are documented in TanStack; alova's App Router and cache behaviour are unverified |
| [0008](0008-container-images-and-ci.md) | Digest-pinned multi-stage Dockerfiles, bundled API, Next standalone, Caddy gateway, hardened compose, CI with hadolint/Trivy/gitleaks/smoke and gated GHCR publish | Smallest runtime surface and a delivery path that fails closed; every claim was run, and what could not be run is listed |
| [0009](0009-ui-direction-from-mockup.md) | Take the mockup's structure, not its assets; re-derive palette for contrast; per-currency totals; no SSO/magic link/CVC branding; Next 16 `proxy.ts`, nonce CSP confirmed | The mockup's own palette fails WCAG AA in several uses (measured); a literal copy would ship accessibility failures, a misleading total and someone else's brand |
| [0010](0010-ai-assisted-pr-review.md) | Proposed: free advisory PR review with GitHub Models (`actions/ai-inference`), non-blocking | Zero cost and no sign-up; free options elsewhere are unconfirmed or need another vendor to read private code |

## How we record a decision (so every step has its reason)
Context, decision, why, alternatives, what we verified locally versus only read, known gaps, and when to revisit. Anything unconfirmed is marked **verify**.
