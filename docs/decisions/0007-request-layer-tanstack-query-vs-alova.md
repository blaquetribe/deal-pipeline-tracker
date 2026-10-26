# ADR 0007: Client request layer: TanStack Query (alova considered)

Status: accepted. Revisit triggers below.

## Question
Can we use alova (alovajs) in this project, and should we?

## Short answer
Technically plausible, **not recommended for this project**. We keep **TanStack Query** (ADR 0001) for client server-state.

## What we found about alova
- A "request strategy layer" for JavaScript: request adapters (fetch, axios, XHR, SuperAgent, GraphQL), 20+ strategies (`useRequest`, `useWatcher`, `usePagination`, `useFetcher`, `useForm`, silent token refresh, retry, rate limiting, atomised requests), response caching with request sharing, and declarative invalidation. MIT, about 4k GitHub stars. Lists Next, React, Vue, Nuxt and many more frameworks.
- Its own docs recommend React Query or SWR for simple CRUD plus caching, and position alova for complex forms, pagination, uploads, cross-platform apps and server-side request governance.

## What we could NOT verify
- **Next.js App Router and React Server Components support:** the landing page and README only list "Next" with an SSR link; I found no App Router or RSC specifics. The follow-up search returned nothing about alova.
- **Cache modes, invalidation rules, and manual cache writes** (what TanStack calls `setQueryData`): not described in what I could fetch.
- Exact current version and release cadence. The claims of "70% less request code" are unsourced marketing.

## Why TanStack Query for us
Our requirements are specific, and TanStack documents each of them:
- **Realtime:** WebSocket events patch the cache (`setQueryData`) and invalidate targeted keys; on reconnect we refetch.
- **Tenant isolation on the client:** query keys include the tenant id, so cached data never crosses a tenant switch.
- **Optimistic stage moves** with rollback, and mutation invalidation.
- **Next.js App Router hydration/prefetch** has a documented pattern and a large body of independent write-ups.
- Mainstream choice: easier for reviewers and the team to read and maintain.

Alova's headline strengths do not apply: session refresh, retry and rate limiting live in the BFF (Hono), not in the browser; we have no cross-platform clients; our forms are small.

## Other points
- **Typed contract:** zod schemas in `packages/shared` are the web/API contract. Hono also offers a typed RPC client; whether to use it in feature 03 is open and independent of this decision.
- Adding alova would put two paradigms in the codebase to document and defend.

## Revisit when (any of)
- We need heavy pagination/upload strategies that TanStack makes awkward.
- A **time-boxed spike** (half a day) shows alova cleanly supports: App Router client components, WebSocket-driven cache writes, tenant-keyed caches and optimistic updates with rollback. If the owner wants alova regardless, run this spike first and record the result as ADR 0008.

## Sources
- https://alova.js.org/
- https://github.com/alovajs/alova
- Comparison articles (alova-favouring, unverified): https://dev.to/coderhu/in-depth-comparison-how-to-choose-the-most-suitable-enhanced-request-library-2p29
