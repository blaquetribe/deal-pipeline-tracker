# Closing soon: the countdown and the alerts

Status: countdown and dashboard summary implemented; server-side alert delivery remains planned across features 02 and 05. Owner decisions confirmed 2026-10-26. Decision record: [ADR 0011](../../decisions/0011-closing-soon-countdown-and-alert.md).
Owners: feature 03 (date maths, countdown UI), feature 05 (realtime delivery), feature 02 (Mailer).

**Requirement:** "closing soon" shows a real countdown, including **hours on the final day**. When a deal reaches **5 days** (and **1 day**, and when it becomes **overdue**) from its expected closing date, the **team and the person assigned** are notified, by an in-app notification and by email that uses the **deal details and a link to the deal**.

## Settings (per tenant, edited by Owner/Admin)
| Setting | Default | Meaning |
|---|---|---|
| Closing-soon window | **60 days** | Deals closing within this many days appear in the dashboard KPI and "Closing soon" list |
| Alert thresholds | **5 days and 1 day** | Calendar days before the close date at which to notify (a list; more can be added) |
| Overdue alert | **on** | One alert when the close date/time passes while the deal is still active |
| Time zone | `Africa/Johannesburg` | How "today", midnight and the close time are interpreted |
| Extra recipients | none | Also notify IC members, or all members |

## The deal fields
- `expected_close_date` (`date`, required to appear in Closing soon).
- `expected_close_time` (`time`, **optional**, interpreted in the tenant time zone). Without it the final day shows "Closes today" and the deal becomes overdue at the start of the next day. With it, the final day counts down in hours and minutes.

## The countdown (UI)
Always text on a chip; an urgent style (tokens, plus icon) at 5 days or fewer and when overdue; never colour alone. A ring may decorate it (`aria-hidden`).

| Situation | Chip text |
|---|---|
| More than 1 day | "12 days left" |
| Tomorrow | "Closes tomorrow" (adds " 14:00" when a time is set) |
| Today, time set, in the future | "Closes in 6h 20m" then "Closes in 42m" |
| Today, no time | "Closes today" |
| Today, time set, passed | "Overdue by 2h" |
| Earlier days | "3 days overdue" |

- **Resolution:** days until the final day; **minutes** on the final day when a time is set. Never seconds (false precision).
- **Live without reloads:** timers are aligned to the next local midnight, or to the next minute boundary when within 24 hours of a set close time; they pause while the tab is hidden and recompute on visibility and after a WebSocket reconnect.
- **Clock skew:** minute-level text is wrong if the laptop clock is wrong, so the client computes an offset from the API's `Date` response header and applies it.
- **Hydration:** the server renders from `closes_in_days`/`closes_at` supplied by the API; the client recomputes after mount.
- **Accessibility:** no per-tick announcements; one polite live message when a deal the user has open crosses into 1 day, today or overdue. Reduced motion: no animation.
- **Shared maths:** `daysUntil` and `timeLeft` are pure functions in `packages/shared` taking an injected clock and a time zone; **parity tests** run the same fixtures against the SQL function (overlay E1). A vetted time-zone library (or the Temporal API once confirmed available) handles DST; **verify the choice** during implementation.

### Implemented dashboard behavior
- `deal_dashboard_summary` enforces `deal.view` in Postgres and returns the tenant time zone, configured window, server clock, next tenant-local midnight, per-stage counts, exact per-currency active pipeline totals, and up to ten nearest closing/overdue deals.
- Postgres computes each deal's tenant-local calendar-day distance and close instant; the browser recomputes calendar days with `Intl.DateTimeFormat` and uses the returned server clock to account for local clock skew. DST calendar-day behavior is covered by the shared countdown tests and pgTAP checks a non-default tenant zone.
- The countdown pauses while the tab is hidden, refreshes at the next tenant-local midnight, and refreshes each minute only while a timed close is within 24 hours. The UI shows no seconds and does not announce each tick.
- The dashboard currently lists up to ten closest dates and reports the full matching count. It groups open pipeline totals by currency and includes active overdue deals in the closing-soon count/list.

## The alerts (server-side, because they must fire when nobody is logged in)
**Rules** for every active deal (not Closed or Passed):
- **5-day and 1-day:** notify when the tenant-local date is on or after `expected_close_date - threshold` and no alert exists for that deal, close date and threshold. `on or after` (not "equals") means deals created or rescheduled inside the window, and missed runs, still alert exactly once.
- **Overdue:** notify once when `now >= close_at`, where `close_at` is the close time on the close date, or the start of the next day when no time is set.

**Scheduler:** a SQL function `scan_closing_soon(now)` (`SECURITY DEFINER`, revoked from PUBLIC) runs **hourly**, judging each tenant on its own local time, so an overdue alert can arrive up to an hour late (accepted). Run it with `pg_cron` (**verified available**: `pg_cron` 1.6.4 is in the Supabase Postgres 17.6 image and preloaded; enable it in a migration), otherwise a timer in the BFF guarded by `pg_try_advisory_lock` so several API instances never double-run it.

**Idempotent by construction:** `notifications.dedupe_key` is unique.
- 5-day and 1-day: `closing:{deal}:{close_date}:{d5|d1}`. Editing only the close time does not duplicate them. Moving to a different date re-arms them.
- Overdue: `closing:{deal}:{close_date}:{close_time}:overdue`. A new close time re-arms it, which is correct (the new time can pass).
- Moving the date back to one that already alerted does not re-alert (stated limit).

**Recipients (confirmed):** the deal's **assignees** (owner and lead) and **deal team members**. If nobody is assigned, or every assignee is deactivated, the tenant **Owner and Admins** are notified instead, so an alert is never silently dropped. An absent assignee is still notified; if they have an active delegation the delegate is notified too. The "extra recipients" setting can add IC members or everyone. All thresholds use the same recipients.

**Channels:**
- **In-app, realtime:** one `notifications` row per recipient and alert, pushed over the tenant-scoped WebSocket (bell badge, toast, polite live region), linking to the deal.
- **Email via the Mailer, one digest per recipient per scan:**
  - **Subject is generic** ("Deals closing soon"): no deal or company name, ever.
  - **Body uses the deal details:** company name, stage, size and currency, expected close (date, time if set, time zone), time left or overdue, assignees, why they received it, and an **Open deal** link per deal.
  - **The link** is `{PUBLIC_BASE_URL}/deals/{deal_id}`. The base URL comes from configuration, never from request headers (host-header injection). It carries **no token** and performs no action: opening it requires signing in like any page, and the BFF/RLS decide what the user may see.
  - HTML and plain-text parts, every value escaped (MARKUP standards). Not sent before 07:00 tenant-local (`not_before`).

**Audit:** each alert writes a `closing_soon_alert` event to the deal ledger (actor **system**, threshold, recipients), so the Activity timeline shows who was told and when.

**Stops:** moving the deal to Closed or Passed ends the countdown and cancels undelivered queued emails for it.

## Data (migrations in features 03 and 05)
- `deals.expected_close_date`, `deals.expected_close_time`.
- `deal_assignees(deal_id, tenant_id, user_id, role)`, role `owner | lead | member`. **Assignment is not access control**: visibility stays tenant-level.
- `tenant_settings`: `timezone`, `closing_soon_days` (60), `alert_days` (`{5,1}`), `alert_on_overdue` (true), `alert_extra_recipients` (`none | ic | all`).
- `notifications(id, tenant_id, user_id, kind, deal_id, dedupe_key unique, payload, created_at, read_at)`; RLS: a user sees and may mark read only their own.
- `email_outbox(id, tenant_id, user_id, kind, payload, not_before, status)` for retry and cancel.

## Edge cases to cover
Close date today, past or edited; time set later, earlier or removed; deal created already inside 5 or 1 day; unassigned deal; assignee removed, deactivated or absent (with and without delegation); closed or passed before delivery; tenant in another time zone (day boundary, DST day with 23 or 25 hours); scan missed for hours; two API instances; a recipient in two tenants (alerts are per tenant, never mixed); a wrong client clock.

## Tests
- **Unit (injected clock and zone):** the countdown ladder above, midnight and minute rollover, DST days, skew offset, no per-tick announcements.
- **DB:** scan twice gives one alert per threshold; late-created and missed-run deals alert once; time-only edit does not duplicate 5/1-day alerts; overdue fires once per close time; closed or passed never alert; recipient resolution incl. unassigned and absent; **a scan can never notify a user of another tenant**; function privileges (not executable by PUBLIC or anon).
- **Parity:** TypeScript `daysUntil` and `timeLeft` against SQL on shared fixtures.
- **Realtime:** the recipient's socket receives it; another tenant's does not.
- **Email:** digest groups per recipient; subject has no deal data; body has the details and the correct link built from config; content escaped; `not_before` respected.

## Decisions confirmed by the owner (2026-10-26)
1. "The team" = the deal's assignees and team members, with the Owner/Admin fallback.
2. Hours on the final day: **yes** (optional close time field).
3. Company names and deal details in the email **body: yes; never in the subject**; the body links to the deal detail page.
4. More thresholds: **yes**, defaulting to 5 days, 1 day and overdue.
