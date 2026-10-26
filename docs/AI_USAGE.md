# AI Usage Log

Running log feeding the README reflection required by the brief. Add an entry per feature or notable session.

## Entry template
- **Date / feature:**
- **What Claude did:**
- **What the human decided or corrected:**
- **How it was verified (tests, review, manual):**
- **What went wrong or was surprising:**

## Entries
### 2026-10-26 / planning
- **What Claude did:** read the brief, produced a requirements report, proposed architecture, tenancy, onboarding, RBAC and approval designs, and the gotcha analysis (`docs/brief/GOTCHAS.md`); scaffolded docs and standards.
- **What the human decided or corrected:** chose Next.js + Hono + Supabase SDK with a separate API boundary and a UI with no Supabase knowledge; required realtime and multi-tenancy; corrected Claude's invite-only suggestion to open sign-up with an Owner; pushed for best-practice financial roles, approvals and absence handling; set quorum, delegation and rejection rules.
- **How it was verified:** n/a (design only).
- **Surprises:** several of the human's requirements go well beyond the brief's scope; a cut list was agreed to manage that.

### 2026-10-26 / foundation, containers, CI, design review, AI-review tooling
- **What Claude did:** built the monorepo, the Oxc toolchain, the Tailwind design layer (adapting the owner's DoorSprint styles), git hooks, Dockerfiles, the Caddy gateway, hardened compose, the smoke test, the CI workflow, a Makefile and the advisory AI-review tooling; reviewed the supplied UI mockup; researched alova, Nuxt-style layering and free AI PR review; wrote the ADRs and standards behind each step.
- **What the human decided or corrected:** chose oxlint/oxfmt over ESLint/Prettier, Tailwind plus reuse of DoorSprint tokens, Husky-style hooks, a Makefile, and free AI review; supplied the mockup and asked for it to be used with judgement, not copied; asked that every step be documented with its reason.
- **How it was verified:** every gate run for real (typecheck, lint, tests, build); hooks proven by blocked commits; smoke test proven to fail on a leaked port; hadolint, Trivy, gitleaks, actionlint and shellcheck; the first GitHub Actions run (all jobs green); 30 mutation-tested offline tests for the AI-review scripts.
- **What went wrong or was surprising:** I pinned TypeScript 6 until oxlint made that unnecessary; `cap_drop: ALL` broke the stock Caddy image; Trivy found HIGH CVEs in npm bundled with the Node image; the mockup's own palette failed WCAG AA when measured; Next 16 renamed middleware to `proxy.ts` (found in the docs shipped in `node_modules`); I broke the Makefile's `.PHONY` list with a partial edit and caught it with a check. **My first AI-review recommendation (GitHub Models) was stale: GitHub retired it on 2026-07-30. I caught it by checking primary sources before building, and rewrote ADR 0010.**
