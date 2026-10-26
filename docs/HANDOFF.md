# Handoff

Keep this current. Anyone (human or agent) should be able to continue from here without the chat history.

## Current state
- Phase: planning complete, scaffold docs written. **No application code, compose, or CI exists yet.**
- Repo: local only (`git init` done, nothing committed, no GitHub remote). Do not push or create the GitHub repo without the owner's go-ahead.

## Next action
Start `00-foundation`: monorepo (pnpm workspaces), TS/ESLint/Prettier config, compose skeleton, CI skeleton. Then `01-schema-security`. Check in with the owner after 01's RLS tests pass.

## Key decisions
See `docs/decisions/0001-architecture.md` and `docs/decisions/0002-gateway-ledger-and-hardening.md` (0002 supersedes parts of 0001). Presentation material: `docs/PRESENTATION_NOTES.md`. `docs/decisions/0003-tooling-and-standards.md` records tooling (Vitest, Dockerfiles, CI docker build, CSS Modules). `GOTCHAS.md` rows 19-40 and the security standards now reflect ADR 0002. Items marked *verify* (Next WS proxying, Next patched version, Realtime with server-held JWTs, Vitest projects syntax, axe package) are unconfirmed until a spike in 00/05. Summary: Next.js UI that knows nothing of Supabase; separate Hono API as sole Supabase client; Supabase CLI migrations; Hono WebSocket relaying RLS-filtered Realtime events; multi-tenant with multi-membership; public sign-up creates Owner; invitations; permission-based RBAC with SoD; k-of-N approvals with absence handling.

## Open questions
- Hosting/deploy target beyond docker compose: none required by the brief.
- Stretch extraction: undecided (model/provider, data exposure).
- Brief receipt date / submission deadline: not recorded yet. Add here.

## Known issues
None yet.

## How to resume
1. Read `AGENTS.md`, `docs/PROGRESS.md`, this file, then the active feature's `progress.md`.
2. Run the commands in `AGENTS.md` (populated after 00).
3. Update this file and `docs/PROGRESS.md` at the end of every session.
