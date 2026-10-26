# 00 Foundation: progress

Status: not started
Owner/branch: feat/00-foundation
Depends on: none

## Goal
Monorepo, tooling, compose skeleton, CI. Covers GOTCHAS rows 3, 6, 7, 19, 20, 25, 36, 37.

## Scope
- In: pnpm workspaces; `tsconfig.base.json` (overlay E5); oxlint, oxfmt, Stylelint; Tailwind v4 and the `packages/ui` design layer; Husky, lint-staged, commitlint; Vitest root config with web/api/shared/ui projects; `supabase test db` wiring; Dockerfiles for web and api; gateway config; compose with internal networks and only the gateway published; `.env.example`; CI jobs `test`, `test-db`, `docker` (hadolint, Buildx build, Trivy, compose smoke, GHCR push on main/tags); secret scan; Dependabot; gateway hardening headers and Hono API headers (ADR 0004); `sharp` build check on Alpine and arm64; spikes for the *verify* items (WS through gateway, Next patched version, Realtime with server-held JWT).
- Out (and where it goes): schema (01), auth (02), app features (03+).

## Design notes
Workspaces: `apps/web` (Next.js 16, App Router, CSS Modules + tokens), `apps/api` (Hono, built with tsup), `packages/shared` (zod contracts, TS source consumed directly). `tsc` only typechecks (`noEmit`); bundlers emit. See `docs/standards/CODING_STANDARDS.md` E5.

## Tasks
Part 1 (done, this branch):
- [x] pnpm workspaces, `tsconfig.base.json` with the strict baseline, Node 24 (`.nvmrc`)
- [x] oxlint (type-aware) + oxfmt + Stylelint replace ESLint/Prettier (ADR 0005); TypeScript 7
- [x] Tailwind v4 and `packages/ui` design layer with DoorSprint-derived tokens and the WCAG contrast test (ADR 0006)
- [x] Husky pre-commit (lint-staged), commit-msg (commitlint), pre-push (typecheck + test); proven to block a bad message and a lint violation without creating a commit
- [x] Cookie-driven theme class (no inline script); layout is dynamic, ready for the nonce CSP
- [x] Lint boundaries: no Supabase in web/shared, in api only under `src/auth` and `src/db`; `dangerouslySetInnerHTML` and `.only` banned
- [x] Vitest root config with web (jsdom + RTL), api (node), shared (node) projects
- [x] Hono `/health` with API security headers (CSP `default-src 'none'`, nosniff, DENY, no-store); zod-validated config
- [x] Next app shell: skip link, `main`, tokens, `StageBadge` component and test
- [x] `pnpm build` produces the Next standalone output and the api bundle; api bundle runs

Part 2 (not started):
- [x] Dockerfiles (web, api, gateway), `.dockerignore`, hadolint clean, images scan clean in Trivy (4 documented expiring exceptions for the upstream Caddy binary)
- [x] Gateway (Caddy) with hardening headers; compose with only the gateway published (internal network comes with Supabase)
- [x] `.env.example`; `scripts/compose-smoke.sh` (17 checks, proven to fail on a leaked port)
- [ ] Supabase stack in compose; `migrate` one-shot; `supabase test db` wiring (CLI not installed locally)
- [x] CI workflow written and actionlint-clean (`quality`, `secrets`, `docker`, `smoke`, `publish`); Dependabot. **First run on PR #1 was green (all jobs; publish skipped by design).** `test-db` job waits for the Supabase stack
- [x] Makefile (`make help`): dev, check, up/down/smoke, hadolint, trivy, secrets, actionlint, ci-local; all targets run locally
- [x] CI first-run verification on GitHub: green
- [ ] (part 2b) `publish` job proven on the first merge to main or tag
- [ ] Spikes: WebSocket through gateway, Realtime with server-held JWT, sharp on Alpine/arm64, S3-compatible container for CI
- [ ] `.claude/` project hooks/commands

## Tests
`pnpm test` runs all Vitest projects (207 tests: stage schema, config parsing, API headers/health, StageBadge, theme parsing, and the full WCAG AA contrast matrix for both themes). Gates: `pnpm typecheck`, `lint`, `stylelint`, `format:check`, `test`, `build`.

## Security checklist (from SECURITY_STANDARDS.md)
- [ ] New tables have `tenant_id`, RLS enabled and forced, policies, tests for each role and cross-tenant.
- [ ] New routes declare auth and permission; signed-out test passes.
- [ ] No client-supplied tenant/author/role/timestamp is trusted.
- [ ] Append-only data cannot be mutated by any role including owner/service.
- [ ] Inputs validated by zod; errors do not leak internals.
- [ ] No secrets, tokens, or PII in logs.
- [ ] Web still has no Supabase dependency.

## Log
- 2026-10-26: Part 1 done. Verified on this machine: Vitest `projects` syntax works (Vitest 5.0.5); Next 16.4.3 builds a standalone output; `typescript-eslint` 8.72 refuses TypeScript 7.0, so TypeScript is pinned to 6.0.x; pnpm 12 blocks dependency build scripts by default, so `esbuild` is explicitly allowed in `pnpm-workspace.yaml`; pnpm 12 does not accept `-s`.
- 2026-10-26: Tooling and styling changes after part 1: oxlint/oxfmt replace ESLint/Prettier (this removed the need to pin TypeScript to 6.x; now 7.0.2); Tailwind v4 + `packages/ui`; hooks. Lint boundaries were re-proven under oxlint with deliberate violations. Findings: oxfmt lowercased font names in CSS and Stylelint `--fix` stripped `-webkit-` prefixes (Tailwind re-adds them); the borrowed contrast test needed three small lint fixes; the layout is now dynamic because it reads the theme cookie. See ADRs 0005-0007.
- Lint boundaries were proven with deliberate violations (all rejected) before being trusted.
- The home page is statically prerendered; the nonce-based CSP (feature 02) needs dynamic rendering, so 02 must opt the layout into it.
- Set `NEXT_TELEMETRY_DISABLED=1` in Dockerfile and CI (Next prints a telemetry notice during build).

## Deviations / debt
- Resolved: the TypeScript 6.x pin was removed by moving to oxlint (ADR 0005).
- oxfmt is beta (and its CSS formatter is not byte-identical to Prettier). Revisit triggers in ADR 0005.
- `allowBuilds: esbuild: true` is a conscious supply-chain decision.
- No Supabase CLI installed locally yet; needed for `supabase test db` and migrations (part 2 / feature 01). Run via `npx`/container or install.
