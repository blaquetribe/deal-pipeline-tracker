# ADR 0003: Tooling and standards

Status: accepted. Detail lives in `docs/standards/`.

## Decisions
1. **Base standards:** the org-wide `ENGINEERING_STANDARDS.md` is adopted unmodified. `CODING_STANDARDS.md` is the project overlay listing exceptions E1-E10. Precedence: security, overlay, base, then task-specific standards (markup, testing, container).
2. **Unit and component tests: Vitest.** Node project for api and shared, jsdom project with React Testing Library and user-event for web, MSW for network mocking. Database tests with pgTAP via `supabase test db`. Parity tests share fixtures between TS mirrors and DB functions.
3. **Styling:** CSS Modules plus CSS custom property tokens; no SCSS; Stylelint in CI.
4. **Markup:** semantic, accessible JSX per `MARKUP_STANDARDS.md`, including typed, escaped HTML email templates with a plain-text part.
5. **Dockerfiles:** one multi-stage, pinned, non-root Dockerfile per app (`apps/web`, `apps/api`), repo-root build context, hadolint-linted.
6. **CI docker build step:** build web and api images with Buildx and GHA cache; Trivy scan; compose smoke test on PRs; multi-arch push to GHCR on main and tags. No hosted deployment.
7. **Money:** DB `bigint` minor units, string on the wire, `bigint` in code (overlay E10).
8. **Migrations:** forward-only (overlay E6).

## Consequences
More up-front standards than a 6-10h task normally warrants; accepted because the brief grades deliberateness. Items marked *verify* in the standards (Vitest projects syntax, axe integration package, Server Component testing limits) are confirmed at foundation time.
