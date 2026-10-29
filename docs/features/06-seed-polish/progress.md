# 06 Seed and polish: progress

Status: in progress
Owner/branch: feat/06-seed-polish
Depends on: 03, 04, 05

## Goal
Realistic two-tenant seed, fresh-clone verification, README. Covers GOTCHAS rows 6, 11, 12.

## Scope
- In: two fictional tenants; six system roles and demo identities per tenant; ten sample deals; safe, idempotent local seeding; clean-clone reviewer flow; README.
- Out (and where it goes): production fixtures, real customer data, a custom role editor, production account provisioning, and hosting remain out of scope and are documented in README / Features 04 and 08.

## Design notes
- Only the internal Compose `demo-seed` job creates the fixed confirmed demo identities through `GoTrue.ensureDemoUser`; the service-role token remains confined to `apps/api/src/auth/gotrue.ts`.
- It then calls the additive `public.seed_demo_data()` migration function with a short-lived `api_service` JWT. The function is executable only by `api_service`, creates tenant-scoped memberships/roles and sample deals through existing database functions, and does not grant direct writes to tables.
- Stable IDs make reruns safe. Existing deals are left untouched; dates are relative to `current_date`; the closing-soon scan is deduplicated by its existing keys. `SEED_DEV_DATA=false` disables the one-shot job.
- No ADR was needed: this follows the existing Compose, API-boundary, RLS, and migration decisions (ADRs 0002, 0014-0016).

## Tasks
- [x] Failing tests written (security/negative first)
- [x] Migration(s)
- [x] API
- [x] Web (existing dashboard is the review surface; no UI code change needed)
- [x] Docs updated (local container limitation and CI follow-up recorded)

## Tests
Unit tests cover fixed identities, `api_service` token use, disabled mode, and fail-closed handling in `apps/api/src/seed.test.ts`; GoTrue account creation/reconciliation is covered in `apps/api/src/auth/gotrue.test.ts`. `supabase/tests/24_demo_seed.test.sql` checks execute grants and direct-write privileges. `scripts/compose-smoke.sh` verifies the reviewer sign-in, tenant selection, visible seeded deal, idempotent rerun, service boundaries, and full pgTAP suite.

## Security checklist (from SECURITY_STANDARDS.md)
- [x] No new tables or public routes; seed function is restricted to api_service and does not grant direct table writes.
- [x] Tenant IDs, role mappings, authors, and sample data are constants inside the trusted seed path; the SQL function checks the stable confirmed accounts before writing.
- [x] Existing append-only audit functions are used for tenant, role, and deal events.
- [x] GoTrue errors are generic; the seed job logs only success or error class, not account credentials.
- [x] Web still has no Supabase dependency.

## Log
- 2026-10-29: Added a one-shot internal API image seed service, fixed fictional demo users, two tenant fixtures with all six system roles, ten sample deals, and an additive restricted SQL function. Added API/GoTrue and pgTAP tests, expanded compose smoke coverage, and replaced the README stub. Initial browser verification caught an origin mismatch on a non-default gateway port; Compose now derives the app origin from `GATEWAY_PORT`, and the smoke test sends that origin. Captured the seeded Asteron dashboard in the browser during the first successful local stack run.
- 2026-10-29: Verification: 561 Vitest tests pass; coverage passes (85.23% global branches, 90.47% API branches); typecheck, lint, stylelint, format, and production build pass. A clean migration/pgTAP run passes 479 assertions across 25 files. The full compose smoke could not finish locally because Podman closed its API connection during image build. GitHub CI successfully exercised the seeded reviewer flow, then found the notification pgTAP test counted alerts from the seeded deals; the test now moves those samples outside the alert window within its rollback-only transaction. Reproducing the seeded database state locally now passes all 479 pgTAP assertions. CI must rerun and pass before the feature is complete.
- The smoke script now prints the full pgTAP output when that check fails, making assertion failures actionable in CI logs.

## Deviations / debt
Anything that differs from the plan or is deferred (also mirror in README "next steps").
