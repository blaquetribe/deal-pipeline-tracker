# 05 Realtime: progress

Status: not started
Owner/branch: feat/05-realtime
Depends on: 03

## Goal
WebSocket relay of RLS-filtered events, live cache updates, presence. Covers GOTCHAS rows 13, 14.

## Scope
- In: WebSocket relay of RLS-filtered events with live cache updates; **notifications** (closing-soon alerts at 5 days, 1 day and overdue: hourly idempotent `scan_closing_soon`, `notifications` rows pushed over the tenant-scoped socket, bell/toast/live region, email digest with deal details and a deal link through the Mailer with `email_outbox`; ADR 0011); presence (cut-list item).
- Out (and where it goes):

## Design notes
Key decisions, schema/API shape, links to ADRs.

## Tasks
- [ ] Failing tests written (security/negative first)
- [ ] Migration(s)
- [ ] API
- [ ] Web
- [ ] Docs updated

## Tests
What is covered, where it lives, how to run it.

## Security checklist (from SECURITY_STANDARDS.md)
- [ ] New tables have `tenant_id`, RLS enabled and forced, policies, tests for each role and cross-tenant.
- [ ] New routes declare auth and permission; signed-out test passes.
- [ ] No client-supplied tenant/author/role/timestamp is trusted.
- [ ] Append-only data cannot be mutated by any role including owner/service.
- [ ] Inputs validated by zod; errors do not leak internals.
- [ ] No secrets, tokens, or PII in logs.
- [ ] Web still has no Supabase dependency.

## Log
Dated notes: what changed, what was learned, problems.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
