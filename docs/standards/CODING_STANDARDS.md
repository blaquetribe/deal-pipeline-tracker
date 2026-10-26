# Coding Standards (project overlay)

The org-wide base is `ENGINEERING_STANDARDS.md`, adopted **unmodified**. This file records where this project deviates from it and adds project-specific rules. Read both before coding.

## Precedence
1. `SECURITY_STANDARDS.md`
2. This overlay (exceptions E1-E10 and project rules)
3. `ENGINEERING_STANDARDS.md` (base)
4. Task-specific standards, read when you touch that area: `MARKUP_STANDARDS.md` (any UI or email template), `TESTING_STANDARDS.md` (any test), `CONTAINER_STANDARDS.md` (Dockerfiles, compose, CI image builds).

Cite exception IDs in PRs ("per E1"). A new deviation needs an ADR.

## Process
1. Read `docs/HANDOFF.md`, `docs/PROGRESS.md`, and the feature's `docs/features/<NN-name>/progress.md` first.
2. One feature at a time, in `PROGRESS.md` order. Do not start a feature whose dependencies are not done.
3. Database first: migration + SQL tests (RLS, grants, immutability) before API; API + tests before UI.
4. Security-relevant behaviour is test-first: write the failing negative test, then the code.
5. Done means: typecheck, lint, stylelint, format check, tests, and docker build pass in CI; feature `progress.md` and `PROGRESS.md` updated; `docs/AI_USAGE.md` entry added; handoff refreshed if state changed.
6. Small, surgical commits, one concern each. No drive-by refactors. Never commit unless asked.

## Exceptions to ENGINEERING_STANDARDS

| ID | Base rule | Project position | Why |
|---|---|---|---|
| E1 | §3.7, §7.1: domain rules live in framework-independent TS | **Postgres is the authority** for consequential rules (stage machine, required fields per stage, quorum, SoD, immutability), as functions/constraints/privileges. TS in `packages/shared` mirrors them for types and UX pre-validation only. **Parity tests**: table-driven fixtures in `packages/shared/fixtures` run through the TS mirror (vitest) and through the DB functions (SQL tests) and must agree. | Rules enforced only in TS are bypassable by anyone with a valid JWT (ADR 0002). |
| E2 | §5.1 example `rejectionPolicy: "blocks" \| "record-only"` | Not used. A rejection **counts against the quorum**: a request fails once approvals plus remaining eligible pending can no longer reach k. Requester cannot approve; one decision per approver; delegation scoped and off by default for IC gates; abstention semantics defined in feature 04. The §3.8 `hasReachedThreshold` sample is illustrative only. | Decided in planning. |
| E3 | §4: SCSS, BEM-inspired names | **CSS Modules + CSS custom properties** (tokens). SCSS is not adopted (YAGNI). Class names inside modules are plain semantic names (`.title`, `.compact`), not BEM. `&__element` suffix nesting is Sass-only and invalid in native CSS nesting. Stylelint still required. If SCSS is ever adopted, §4.4 applies in full. | Scoped modules make BEM redundant; avoids a second language. |
| E4 | §2.1 `src/features/...` layout | Applies **inside each app**: `apps/web/src/features`, `apps/api/src/features`. Next.js App Router conventions win for `apps/web/src/app`. Cross-package sharing only via `packages/shared`. ESLint boundary rules forbid deep imports into another feature. | Monorepo + framework conventions. |
| E5 | §3.1 single compiler baseline incl. global `noEmit` | `tsconfig.base.json` carries the §3.1 flags. `noEmit` only in `apps/web` and `packages/shared`; `apps/api` emits (build output is what the Docker image runs). Next's required options may be added. If a library's types fight `exactOptionalPropertyTypes`, relax it **per package** with a comment and ADR link, not globally. | Different runtimes. |
| E6 | §8.2 "forward/backward strategy" for migrations | **Forward-only.** Never edit an applied migration; fix with a new one. No down migrations. | Supabase CLI workflow; audited history. |
| E7 | §2.2 test file stem | `*.test.ts` / `*.test.tsx` co-located; SQL tests in `supabase/tests/*.sql`. | One convention. |
| E8 | §13.1 separate `CONVENTIONS.md` | `AGENTS.md` plus this overlay are the convention registry. | Avoid duplicate sources of truth. |
| E9 | Vue/`vue-tsc` examples | Read as React/Next equivalents (`ApprovalCard.tsx`, `tsc --noEmit`). | Stack is Next.js. |
| E10 | §7.2 money / dates | Amounts: DB `bigint` minor units; **wire = string of integer minor units**; code = `bigint`. Never `number` for money. Currency = ISO-4217 code, default ZAR. Dashboard totals are per currency. Dates on the wire are ISO 8601 strings; calendar dates (e.g. expected close) are `date` with no timezone. | JSON cannot carry bigint; avoid float drift. |

## Project rules (not in the base)

### Boundaries
- `apps/web` must not import or depend on any Supabase package (lint `no-restricted-imports` + CI dependency check).
- Supabase Auth is imported only under `apps/api/src/auth/`. The Supabase data client is created only in `apps/api/src/db/`, per request, with the user's session token.
- The service-role key is read only by migration/seed scripts, never by request handlers.

### API (Hono)
- One router module per resource; thin handlers; logic in services; data access calls DB functions.
- Every route declares its auth and permission through a typed route helper. A route without a declaration fails typecheck/tests (default deny).
- zod validators on params, query, body; unknown fields rejected. Domain errors map to HTTP in one place with stable error codes.
- Request id on every log line; no secrets/tokens/bodies in logs.

### Web (Next.js)
- Server state only through TanStack Query hooks; query keys always include tenant id; one API client module; no `fetch` in components.
- WebSocket events are applied to the cache only by the single `useRealtime` hook.
- Server Components by default; `"use client"` only where interaction requires it.
- Markup, forms and email templates follow `MARKUP_STANDARDS.md`.

### Database
- Every change is a new timestamped file in `supabase/migrations`. Never change schema by hand or in Studio.
- Snake_case; plural table names; `id uuid primary key default gen_random_uuid()`; `created_at timestamptz not null default now()`.
- Every business table: `tenant_id uuid not null`, RLS enabled and **forced**, policies in the same migration, tenant-leading indexes, composite FKs tying child tenant to parent tenant.
- `SECURITY DEFINER` functions: pinned `search_path`, schema-qualified, revoked from PUBLIC with explicit grants, documented why (see security standards).
- No direct write grants for `authenticated` on core tables; writes go through functions.

### Style and git
- Prettier, ESLint (typescript-eslint, type-aware), Stylelint enforced in CI. Named exports. Files under about 300 lines.
- Comments explain why. No dead or commented-out code. No TODOs without an entry in the feature's `progress.md`.
- Conventional commits (`feat(deals): ...`). Branch per feature `feat/<NN-name>`. CI green before merge.

## Scripts (root `package.json`; names fixed so CI and docs agree)
`typecheck`, `lint`, `lint:fix`, `stylelint`, `format`, `format:check`, `test` (vitest run, all projects), `test:watch`, `test:coverage`, `test:db` (`supabase test db`), `build`, `docker:build`, `compose:smoke`.
