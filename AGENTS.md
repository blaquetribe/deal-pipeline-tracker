# AGENTS.md

Deal Pipeline Tracker: multi-tenant, realtime, auth-gated deal pipeline for a financial firm. Take-home for CVC Capital Partners. Quality, security and explainability matter more than breadth.

## Read before any work (in order)
1. `docs/HANDOFF.md`: current state, what to do next, known issues.
2. `docs/PROGRESS.md`: feature status and the build order.
3. `docs/features/<NN-name>/progress.md` for the feature you are touching.
4. Standards, in precedence order: `docs/standards/SECURITY_STANDARDS.md`, `CODING_STANDARDS.md` (project overlay, exceptions E1-E10), `ENGINEERING_STANDARDS.md` (org base). Read when touching that area: `MARKUP_STANDARDS.md` (UI and email templates), `TESTING_STANDARDS.md` (tests), `CONTAINER_STANDARDS.md` (Dockerfiles, compose, CI images).
5. `docs/brief/GOTCHAS.md` for the brief's traps; `docs/decisions/` for locked architecture.

## Non-negotiables
- `apps/web` never touches Supabase. `apps/api` is the only Supabase client. Supabase Auth only under `apps/api/src/auth/`.
- Authorization is enforced by Postgres RLS and DB functions; API guards and UI are secondary.
- Notes, approval decisions and other audit records are append-only and must be unmodifiable by any role, including owner and service role.
- Schema changes only via new migration files in `supabase/migrations`. Never edit applied migrations, never use Studio or ad-hoc SQL.
- Everything is tenant-scoped. Never trust client-supplied tenant, author, role, or timestamps.
- No secrets in the repo. No floats for money.
- Fail closed: no auto-approvals, no default-allow.
- Consequential rules (stage machine, quorum, SoD, immutability) are enforced in Postgres functions and privileges; TS copies are mirrors with parity tests.
- Only the gateway publishes a host port. Supabase is never reachable from the host.
- Tests are Vitest (unit and component) plus pgTAP; every app has a Dockerfile; CI builds, scans and smoke-tests the images.
- `apps/api` is the BFF: the browser never talks to Supabase or to object storage. Files go through the `ObjectStore` port (fs default, Cloudflare R2 by config), authorised by the tenant-scoped `files` table, streamed through the BFF; no presigned URLs.
- CSP (nonce-based, Next middleware) and hardening headers (gateway, Hono) are mandatory; no inline scripts, no third-party origins, no CSP report endpoint.

## Layout
```
apps/web          Next.js UI (no Supabase)
apps/api          Hono API + WebSocket (only Supabase client)
packages/shared   zod schemas and types (the web/api contract)
packages/ui       design layer: tokens, themes, materials, contrast test (Tailwind v4)
gateway/          reverse proxy config (only published port)
supabase/         migrations, seed, SQL tests
.github/          CI workflows (test, test-db, docker)
docs/             handoff, progress, features/<NN-name>/, standards, brief, decisions
```

## Workflow
- One feature at a time in the order in `docs/PROGRESS.md`. DB and tests first, then API, then UI.
- Write failing security/negative tests before implementation.
- Done means: CI green (typecheck, lint, tests), feature `progress.md` and `docs/PROGRESS.md` updated, `docs/AI_USAGE.md` entry added, `docs/HANDOFF.md` refreshed.
- Surgical changes only. Do not commit, push, or create PRs unless the user asks.
- If the plan conflicts with the brief or standards, stop and raise it; do not silently deviate. Record decisions as a new ADR in `docs/decisions/`.

## Commands
Node 24 (`.nvmrc`), pnpm 12 (no `-s` flag). From the repo root:

```bash
pnpm install            # frozen lockfile in CI
pnpm typecheck          # tsc --noEmit in every workspace (TypeScript 7)
pnpm lint               # oxlint --type-aware (boundaries, a11y, hooks rules)
pnpm stylelint          # CSS in apps/web and packages/ui (Tailwind-aware)
pnpm format:check       # oxfmt --check (pnpm format to fix; sorts imports and Tailwind classes)
pnpm test               # Vitest, all projects (web, api, shared, ui)
pnpm build              # next build + tsup
```

`make help` lists every developer target (`make check`, `make dev`, `make up`, `make smoke`, `make hadolint`, `make trivy`, `make secrets`, `make ci-local`). UI work: read `docs/design/mockup-review.md` and ADR 0009 first. Next 16 calls middleware `proxy.ts`; the installed Next docs are in `apps/web/node_modules/next/dist/docs`.

Git hooks (Husky):

Containers: `pnpm docker:build` builds the images; `pnpm compose:smoke` builds, starts the stack and tests it through the gateway (needs Docker or Podman with compose, plus `jq`). `docker compose up --build` starts the stack; only the gateway publishes a port (default 8080).

Still to come in feature 00: Supabase stack in compose, `test:db`.
