# Deal Pipeline Tracker

A multi-tenant, authentication-gated investment pipeline for a small financial team. Deals move through Sourcing, Screening, Due Diligence, IC Review, Signed, and Closed, or can be Passed. Postgres enforces tenant access, stage rules, approval decisions, and append-only audit history.

This is a local take-home project. It contains fictional companies and synthetic identities only; it is not affiliated with CVC Capital Partners and is not configured for production use.

## Run locally

Prerequisites: Docker Desktop or Docker Engine with the Compose plugin, `curl`, and a browser. The first run builds the app images and pulls the database, auth, mail, and gateway images. Allow several minutes and a few gigabytes of free disk; allocating about 8 GB of memory to Docker is a practical starting point for the full stack.

```sh
docker compose up --build
```

Open <http://localhost:8080> and sign in with one of the demo accounts:

| Tenant | Email | Role |
| --- | --- | --- |
| Asteron Capital | `owner@asteron.example.test` | Owner |
| Asteron Capital | `admin@asteron.example.test` | Admin |
| Asteron Capital | `lead@asteron.example.test` | Deal Lead |
| Asteron Capital | `member@asteron.example.test` | Deal Team Member |
| Asteron Capital | `ic@asteron.example.test` | IC Member |
| Asteron Capital | `observer@asteron.example.test` | Observer / Compliance |
| Imbali Growth Partners | `owner@imbali.example.test` | Owner |
| Imbali Growth Partners | `admin@imbali.example.test` | Admin |
| Imbali Growth Partners | `lead@imbali.example.test` | Deal Lead |
| Imbali Growth Partners | `member@imbali.example.test` | Deal Team Member |
| Imbali Growth Partners | `ic@imbali.example.test` | IC Member |
| Imbali Growth Partners | `observer@imbali.example.test` | Observer / Compliance |

The local-only password for all demo accounts is `Dev-only-demo-password-change-me`. Override it by setting `SEED_DEMO_PASSWORD` in an untracked `.env` before startup. The seed job resets these fixed demo account passwords on each run. To start without sample accounts, set `SEED_DEV_DATA=false` in `.env`; public sign-up remains disabled in this compose environment.

The sample data has ten fictional deals across both tenants and several pipeline stages. Dates are generated relative to the day the seed runs, so closing-soon examples remain useful. The local Mailpit inbox is available at <http://localhost:8080/mail/>.

To stop the stack, press `Ctrl-C`. To remove containers and erase the local database volume, run:

```sh
docker compose down -v
```

Only the gateway publishes a host port. Set `GATEWAY_PORT` if port 8080 is already in use. Compose includes clearly marked development defaults so a fresh clone needs no `.env`; `make env` can generate machine-specific local values. Never reuse these development credentials or secrets in a deployed environment.

## Architecture

- `apps/web` is the Next.js interface. It calls the same-origin API and has no Supabase client.
- `apps/api` is the Hono backend-for-frontend. It owns Supabase Auth, PostgREST, database access, session cookies, and the realtime relay.
- `packages/shared` holds validated request and response contracts; `packages/ui` holds design tokens and shared UI primitives.
- `supabase/migrations` is the source of truth for schema changes. Postgres RLS and database functions enforce tenant boundaries and consequential rules. pgTAP checks those rules.
- The internal Supabase services and Mailpit are reachable only on Compose networks. Caddy is the sole published entry point.
- The one-shot `demo-seed` job creates fixed development identities through GoTrue and calls a narrowly granted database function using the `api_service` role. It does not expose a public seed endpoint or grant that role direct table writes.

## Decisions and trade-offs

- The browser never connects directly to Supabase. The API boundary centralizes session handling and keeps database credentials out of the client.
- Postgres is authoritative for tenant authorization, role permissions, stage transitions, approval quorum and separation of duties. TypeScript validation mirrors database rules for clear UI feedback, with parity tests where applicable.
- Notes, approval decisions, and audit events are append-only. Money is stored as integer minor units, not floating-point values.
- The local Compose stack is optimized for a reproducible review path, not production hosting. It uses development defaults, local Mailpit, and a file-backed object store. There is no hosted deployment pipeline.
- System role definitions are immutable; tenant members with `role.manage` can define audited custom roles through database functions that enforce permission catalog membership and separation of duties. Approval absences, reassignment, and opt-in scoped delegation also use database-enforced, audited workflows. Presence is outside the core review path.

More detail and the rationale behind locked choices live in [`docs/decisions/`](docs/decisions/), [`docs/standards/`](docs/standards/), and [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Development and verification

Use Node 24 and pnpm 12 (versions are pinned in `.nvmrc` and `package.json`). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm stylelint
pnpm format:check
pnpm test
pnpm build
make test-db
scripts/compose-smoke.sh
```

The smoke test builds a fresh stack, signs in through the gateway as a seeded user, checks that sample deals are visible, runs the seed again to check idempotency, and verifies that only the gateway publishes a port. `docker compose down -v` removes the smoke stack's data when run outside the smoke script.

GitHub Actions runs the quality, database, image, security-scan, and Compose smoke checks. The repository is private, but branch protection is unavailable on its current GitHub plan, so a green workflow is not mechanically required before merging. Pull requests have been merged after their required checks passed.

## What I would do next

- Feature 04 custom role editing is implemented and merged. Database/API delegation is tenant opt-in, time-bounded, and preserves the original approver slot; the UI lets approvers schedule and revoke their own delegation. Unavailable slots without an eligible replacement intentionally block signing. Unreachable quorum now produces an hourly in-app alert to the request creator and active Owner/Admin members.
- Add notification preference controls and absence/delegation-aware recipients. Decide how to handle the rare duplicate email after SMTP succeeds but outbox completion persistence fails. Presence remains deferred.
- Run a real Cloudflare R2 smoke test with a dedicated bucket-scoped token; Feature 08's S3-compatible driver, local file store, BFF file routes, avatar upload, and initials fallback are implemented. Virus scanning and presigned URLs remain out of scope.
- Finish the project-wide UI pass using Doorsprint as a visual reference. The shared button system and native input/select/textarea baseline are in place, and auth, onboarding, tenant-switcher, deal, delegation, and role forms now use shared React control wrappers. These preserve native semantics and use the existing tokens; no new dependency was needed. Evaluate shadcn components for complex interactions where they add value. Activity events now use human-readable stage labels, assignment summaries, and closing-alert copy. Baseline Board and deal activity screenshots are in `docs/evidence/ui/`; refresh them during final visual QA. Then prepare the full feature walkthrough presentation, including the rationale for key decisions, as the final project task.
- Optional stretch: document extraction. IC approval SLA escalation is implemented as a one-time in-app alert after 24 hours; approval gates at other stages are outside the agreed workflow.
- Measure memory and disk use on Docker Desktop and verify the stack on both amd64 and arm64 hosts; local container verification to date has primarily used Podman on arm64.

The deals page offers List and Board views. Board drag-and-drop uses the same allowed stage transitions and version checks as the keyboard-accessible List controls. Both views share server-side filters and pagination; the board displays the current page of results. Reduced-motion preferences disable its transition effects.

## AI use

Claude and Codex assisted with implementation, tests, documentation, and investigation. The human set scope, reviewed decisions, corrected direction, and authorized repository actions. AI output was treated as a proposal: database rules, security boundaries, migration history, CI results, and the running UI were checked directly. See [`docs/AI_USAGE.md`](docs/AI_USAGE.md) for the feature-by-feature record and surprises.
