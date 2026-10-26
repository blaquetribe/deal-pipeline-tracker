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

### 2026-10-26 (later) / coverage, secrets incident, Supabase stack measurement
- **What Claude did:** implemented coverage (V8, all files, thresholds, CI summary and artifact) and compared it with Istanbul on our code; found real-looking credentials in the tracked `.env.example`, verified they had not leaked, preserved them in a gitignored `.env`, restored a placeholders-only template and added a guard with tests; measured the official Supabase stack (full and trimmed) and verified auth, REST, the unconfirmed-login rule, realtime and database extensions against the real services.
- **What the human decided or corrected:** asked for coverage and chose the R2 layout (one bucket, `Dev/` and `Prod/` folders); asked Claude to pick between two configuration patterns, which Claude chose on the evidence (generic `STORAGE_*`, no public bucket).
- **How it was verified:** thresholds proven to fail on a planted untested file; the guard proven in a throwaway repo to block a staged secret without printing it; Supabase behaviour exercised with real requests, not just container health.
- **What went wrong or was surprising:** my first functional check of the trimmed stack was inconclusive (admin-style endpoints returned 403), so I re-ran it properly; the Supabase gateway is now Envoy, not Kong; a `Makefile` edit of mine split a target and was caught and repaired.
