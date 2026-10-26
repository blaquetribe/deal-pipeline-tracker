# ADR 0011: Closing-soon countdown and the 5-day alert

Status: accepted (design). Detail: [`docs/features/03-deals-core/closing-soon.md`](../features/03-deals-core/closing-soon.md). Supersedes the 30-day default assumed earlier; the mockup's 60 days is adopted.

## Decisions
1. **Window 60 days, alert at 5 days**, both per-tenant settings; alert thresholds stored as a list.
2. **A real countdown at day resolution**, rolling over at the tenant's local midnight without a reload; shown as text with an urgency style at 5 days or fewer and when overdue. No per-second ticking: the close date has no time of day.
3. **The alert is server-side**, evaluated hourly by an idempotent SQL function, because it must fire when nobody is logged in. `<=` the threshold, with a unique dedupe key `(deal, close date, threshold)`, so late-created, rescheduled and missed-run cases alert exactly once.
4. **Recipients:** the deal's assignees and team members; fallback to Owner/Admins when nobody is assigned so an alert is never silently lost.
5. **Channels:** realtime in-app notification and a per-recipient email digest with a generic subject. Each alert is also written to the audit ledger with actor *system*.
6. **Assignment is not access control.** `deal_assignees` records who is responsible; visibility stays tenant-level.

## Why
- A front-end timer cannot notify anyone who is offline, and a notification that fires twice or not at all is worse than none in a deal process. Idempotency, tenant-local dates and a never-silent fallback address those.
- Day resolution matches the data; claiming second precision would be misleading.
- A ledger entry makes the alert auditable, consistent with the rest of the audit design.

## Consequences
New tables (`deal_assignees`, `tenant_settings`, `notifications`, `email_outbox`), a scheduler, and a deal-team concept the earlier scope did not have. This is core (owner requirement); the cut-list fallback is to ship in-app notifications first and add the email digest second.

## Open
Who "the team" is, hours on the final day, company names in the email body, further thresholds (see the design doc). Whether `pg_cron` exists in the Supabase Postgres image is **unverified**; the BFF timer with an advisory lock is the fallback.

## Update 2026-10-26: owner's answers to the open questions
1. **"The team"** = the deal's assignees and team members, with the Owner/Admin fallback (the default above is confirmed).
2. **Hours on the final day: yes.** Adds an optional `expected_close_time` (tenant time zone). The countdown shows hours and minutes on the final day when a time is set; still never seconds. Needs time-zone/DST-safe maths, a client clock-skew offset from the API `Date` header, and minute-aligned timers.
3. **Email body carries the deal details and a link to the deal detail page; the subject never names a deal.** The link is built from configured `PUBLIC_BASE_URL` (not request headers), carries no token and performs no action; it requires normal sign-in.
4. **More thresholds: yes.** Defaults become **5 days, 1 day and overdue** (one alert when the close date/time passes while the deal is active). Dedupe keys: `d5` and `d1` are per (deal, close date, threshold), so editing only the time does not duplicate them; `overdue` is per (deal, close date, close time).

Consequences: a new optional field and DST/clock-skew tests; the overdue alert can arrive up to an hour late because the scan is hourly (accepted). The design doc is updated accordingly.
