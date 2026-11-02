# Deal Pipeline Tracker

A multi-tenant, authentication-gated investment pipeline for a small financial team. Deals move through Sourcing, Screening, Due Diligence, IC Review, Signed, and Closed, or can be Passed. Postgres enforces tenant access, stage rules, approval decisions, and append-only audit history.

This is a local take-home project. It contains fictional companies and synthetic identities only; it is not affiliated with CVC Capital Partners and is not configured for production use.

## Run the local development stack

Follow these steps from the repository root. The Compose stack runs the web app, API, database, authentication service, realtime service, gateway, Mailpit, migrations, and demo seed. Only the gateway is exposed to your host. The first build downloads images and compiles the app; allow several minutes and a few gigabytes of free disk. About 8 GB of memory is a practical starting point for the complete stack.

### 1. Start Docker or Podman

On macOS, open Docker Desktop and wait until its engine reports that it is running. If you use Podman, start its virtual machine when it is stopped:

```sh
podman machine list
podman machine start
podman compose version
```

On Linux with Docker Engine, confirm Compose is available:

```sh
docker compose version
```

Use the same Compose command in every step below: `docker compose` for Docker Desktop/Engine or `podman compose` for Podman. Compose includes development-only defaults, so a fresh checkout does not require a `.env` file. If you prefer per-machine generated secrets, run `make env` before startup; this writes only to the ignored `.env` file.

### 2. (Optional) Set a private local demo password

All seeded users share a development-only password by default. To use a different one, create or edit the ignored `.env` file in the repository root **before the first startup** and add:

```dotenv
SEED_DEMO_PASSWORD=choose-a-local-password-at-least-12-characters
```

The seed job sets this password on each run. To apply a changed password to an already-created local stack, recreate only that job:

```sh
docker compose up --force-recreate demo-seed
```

Replace `docker compose` with `podman compose` when using Podman. Keep `.env` private and never use the demo password outside local development.

### 3. Build and start the application

Start the stack in the background:

```sh
docker compose up --build -d
```

Use `podman compose up --build -d` for Podman. The first start applies every migration, creates the demo accounts and sample deals, then starts the API and gateway. Wait for the gateway, web, API, and Mailpit services to report healthy; `migrate` and `demo-seed` should show as completed successfully:

```sh
docker compose ps
curl --fail --show-error http://localhost:8080/api/health
```

If port 8080 is already in use, start on another port. For example:

```sh
GATEWAY_PORT=8081 docker compose up --build -d
```

Then use `http://localhost:8081` and `http://localhost:8081/mail/` in the remaining steps. The gateway is the only service that publishes a host port.

### 4. Sign in and choose an organisation

Open <http://localhost:8080> (or the port you selected), enter one account from the table below, and use the shared local password `Dev-only-demo-password-change-me`. On the first sign-in, choose the account’s organisation in the **Organisation** selector. Accounts belong to one tenant each; use an Asteron account for Asteron Capital or an Imbali account for Imbali Growth Partners. The selector appears in the top bar when more than one organisation is available to that account. Sign-in opens **My Work**, the personalized dashboard. Select **Pipeline** for the organisation-wide deal view.

The seeded accounts are confirmed development users, so they do not need an email verification step. Public sign-up is disabled in the local Compose environment. To inspect verification and invitation email flows, open the local Mailpit inbox at <http://localhost:8080/mail/>.

Use the **Dark mode** or **Light mode** button in the top bar to switch themes; your choice is saved in a browser cookie. The account menu also provides **Change photo**. Select a PNG, JPEG, or WebP file smaller than 5 MB and wait for **Profile photo updated**. To test deal files, open a deal, select **View attachments**, then **Add PDF** (PDF files up to 20 MB). Both upload types pass through the API and are stored privately for the active organisation.

### 5. Choose a test account

| Organisation | Account email | Role | Useful checks |
| --- | --- | --- | --- |
| Asteron Capital | `owner@asteron.example.test` | Owner | Manage invitations, custom roles, organisation settings, and deals |
| Asteron Capital | `admin@asteron.example.test` | Admin | Manage invitations and review tenant settings without IC approval rights by default |
| Asteron Capital | `lead@asteron.example.test` | Deal Lead | Create and update pipeline deals, assignments, and stage movement |
| Asteron Capital | `member@asteron.example.test` | Deal Team Member | Review assigned work and deal activity |
| Asteron Capital | `ic@asteron.example.test` | IC Member | Review and decide IC approval requests |
| Asteron Capital | `observer@asteron.example.test` | Observer / Compliance | Verify read-only pipeline and audit activity access |
| Imbali Growth Partners | `owner@imbali.example.test` | Owner | Manage invitations, custom roles, organisation settings, and deals |
| Imbali Growth Partners | `admin@imbali.example.test` | Admin | Manage invitations and review tenant settings without IC approval rights by default |
| Imbali Growth Partners | `lead@imbali.example.test` | Deal Lead | Create and update pipeline deals, assignments, and stage movement |
| Imbali Growth Partners | `member@imbali.example.test` | Deal Team Member | Review assigned work and deal activity |
| Imbali Growth Partners | `ic@imbali.example.test` | IC Member | Review and decide IC approval requests |
| Imbali Growth Partners | `observer@imbali.example.test` | Observer / Compliance | Verify read-only pipeline and audit activity access |

The account names and roles come from the development seed. Permissions are enforced by Postgres, so a role may see controls that are disabled or absent when it lacks the required permission. Use the Owner for the complete walkthrough, then sign out and try the Deal Lead, IC Member, and Observer accounts to compare their personalized assignments, edit access, pending approvals, and read-only access. Login is limited to five submissions per client IP in a 15-minute window (and five per account); rapid role switching in one browser can reach that limit, so space the sign-ins during a live demo. The seed creates ten fictional deals across both organisations; close dates are relative to the seed date.

### 6. Walk through My Work, team access, and IC approvals

**My Work** opens after sign-in. It shows your assigned deals with your responsibility on each, a stage progress indicator, any IC decisions awaiting your vote, and your recent notifications. Assignment is a responsibility label; it does not change tenant-wide deal visibility. Passed is shown as an outcome, while Closed is the completed end of the stage indicator. Use **Pipeline** for all organisation deals, filters, and Board/List views. The Board opens first and separates the six progression stages from **Passed**, a terminal outcome. Use the List when you need dense rows, keyboard stage controls, or inline access to **Edit**. On the Board, drag only to a valid destination; on the List, choose **Move to…** to see allowed destinations. If a required deal field is missing, the menu names it. For an IC Review deal, choose **Open IC approval** in its row or edit dialog to reach the approval section. The **Request IC approval** button appears only for users with `deal.request_approval` access. The built-in Deal Lead has that permission; Owners configure quorum, and eligible IC Members decide. From the deal's **IC approval** section, an eligible IC Member selects **Reject** and can enter a reason. This records an approval decision; it does not move the deal to another pipeline stage. The deal stays in IC Review unless it reaches the approval quorum (which moves it to Signed) or someone moves it to **Passed** as the separate outcome for leaving the pipeline.

After signing in as an Owner or Admin, select **Team** in the workspace navigation. Enter a teammate's work email, choose the role they should receive after accepting, and select **Send invitation**. The same page lists pending invitations and allows an authorized manager to revoke them. To exercise acceptance, use a separate browser session for the invited address and follow the link in Mailpit at <http://localhost:8080/mail/>. Invitation links expire after seven days. **Roles** is the separate place to review system permissions and create or edit custom roles.

Select **Approvals** to see deals in **IC Review**, their quorum/decision state, and a link to open each deal's review controls. If no request exists, the queue explains whether your role can start it. The built-in Owner/Admin roles do not request IC approval: an Owner configures quorum, a Deal Lead (or another explicitly authorized requester) submits from the deal page, and eligible IC Members approve or reject. The development seed intentionally does not create a live approval request or decision, because those actions write immutable audit records. To see the full approval cycle, use an IC Review deal and submit a request as its Deal Lead; then sign in as an eligible IC Member to review it. **Team** lists accepted and deactivated members, their organisation roles, and outstanding invitations. Owners/Admins can invite a teammate with an eligible role; Owners can grant privileged roles. From the roster, managers can add/remove roles or confirm account deactivation. Self-role changes are disabled, and Postgres enforces tenant permissions, separation of duties, and last-Owner protection. Deactivated accounts remain listed for audit context; to restore access, send the person a new invitation.

In **Pipeline → List**, select a column heading to sort. Combine stage, sector, assignee-name, and approval-status filters with deal search; filtering and sorting run in the tenant-authorized database query. Deal rows, Board cards, My Work, deal detail, Approvals, and upcoming-close entries show available creator, last updater, assigned team, IC approvers, and rejection state/reason. Creator/updater/time and approval outcome are system-attributed and read-only; assignments change through the deal assignment control. At **IC Review**, the requester sees eligible approvers, their approval roles, and active delegation, then selects the people who should receive the request. The database rechecks eligibility and quorum and snapshots the selected recipients.

Live updates use a tenant-scoped WebSocket invalidation. Postgres emits a content-free signal after deal events, assignment, team/role/invitation, approval-policy/absence/delegation, and file changes. The API relays only `deals_changed`; each open view reloads through its normal authenticated API and database authorization. Notification rows continue through the existing RLS-filtered notification stream. Deal or user details are not broadcast in the invalidation message.

### 7. Stop, restart, or reset the stack

Stop containers while preserving the local database and uploaded files:

```sh
docker compose down
```

Restart the existing data without rebuilding:

```sh
docker compose up -d
```

Rebuild web/API images after changing source code:

```sh
docker compose up --build -d web api gateway
```

To erase the local database, demo accounts, and uploaded files and start from a clean database, remove the volumes and then start again:

```sh
docker compose down -v
docker compose up --build -d
```

**The `down -v` command permanently deletes this checkout’s local database and file-storage volumes.** It does not affect any remote environment. Replace `docker compose` with `podman compose` for Podman.

For container logs while investigating a local issue:

```sh
docker compose logs --tail=100 web api gateway
```

To run without sample accounts, set `SEED_DEV_DATA=false` in `.env` before startup. The application still has no public sign-up in this local stack.

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

GitHub Actions runs the quality, database, image, security-scan, and Compose smoke checks. Branch protection is unavailable on the repository's current GitHub plan, but the project merge rule is to merge only after all required checks pass. Earlier runs were blocked before job startup by an account billing limit; PR #50 later passed all required checks, including the clean-clone Compose smoke test. The skipped image-publish job is not a required PR check. Local verification and historical failures are recorded in `docs/HANDOFF.md` and `docs/PROGRESS.md`.

## Project completion and follow-ups

PR #51 merged the sortable/filterable List, database-attributed deal audit fields, requester-selected eligible IC approvers, and tenant-scoped realtime invalidation to `main` as `9b257f4`. All required GitHub checks passed. Local verification passed: 756 Vitest tests (1 skipped, 85.15% branch coverage), typecheck, lint, stylelint, formatting, build, and 679 pgTAP assertions across 36 files. The feature was reviewed in the isolated port-8082 app, but fresh repository screenshots of the List and approver selector and refreshed mobile evidence have not been saved. Screenshots 16–18 remain evidence of the 1 November visual redesign, not the new List or approver-routing details.

The retained port-8081 walkthrough ledger confirms a 1-of-1 Deal Lead request, IC Member approval, and automatic move to Signed. The isolated port-8082 review app currently has a pending approval request assigned to an IC Member; it was not voted on during this closeout. The [14-slide walkthrough and decision rationale](docs/presentation/deal-pipeline-tracker-walkthrough.pptx) was refreshed on 2 November with the approval-rejection and stage distinction.

Environment-dependent follow-ups:

- Verify a production SMTP relay and certificate chain. A rare duplicate email remains possible if SMTP accepts a message and the outbox completion write then fails. Session refresh has a separate documented crash window between GoTrue token rotation and persistence.
- A scoped Cloudflare R2 object round trip passed on 31 October 2026 (PUT, GET byte comparison, DELETE, and absence check). The app remains configured for filesystem storage. Virus scanning and presigned URLs remain out of scope.
- Verify memory use and behavior on Docker Desktop and amd64 hosts. CI's image builds and Compose smoke passed; local cross-platform validation remains outstanding.
- Docker Desktop/amd64 validation remains environment-dependent. Earlier GitHub Actions failures were blocked before job startup by the account billing limit; PR #50's required checks are green. Live AI PR review still needs the owner's Cloudflare secrets and `ai-review` label.

Optional stretch work remains document extraction and realtime presence. Approval gates beyond IC Review, FX conversion, per-deal information barriers, hosted deployment, and legal sign-off on POPIA retention remain outside the agreed scope.

Remaining closeout evidence: save current List and approver-routing UI captures, capture a refreshed mobile screen, and verify invalidation delivery across two authenticated sessions. Production SMTP, Docker Desktop/amd64 behavior, and two-session `move_stage` contention coverage also remain environment-dependent follow-ups. These do not change the fact that PR #51's code is merged; report them as unverified evidence and platform limits.

The deals page offers List and Board views. Board drag-and-drop uses the same allowed stage transitions and version checks as the keyboard-accessible List controls. Both views share server-side filters and pagination; the board displays the current page of results. Reduced-motion preferences disable its transition effects.

## AI use

Claude and Codex assisted with implementation, tests, documentation, and investigation. The human set scope, reviewed decisions, corrected direction, and authorized repository actions. AI output was treated as a proposal: database rules, security boundaries, migration history, CI results, and the running UI were checked directly. See [`docs/AI_USAGE.md`](docs/AI_USAGE.md) for the feature-by-feature record and surprises.
