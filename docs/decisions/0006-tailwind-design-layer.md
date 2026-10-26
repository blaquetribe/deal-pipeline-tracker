# ADR 0006: Tailwind, the `packages/ui` design layer, and layering in general

Status: accepted. Supersedes overlay exception E3 (CSS Modules) from ADR 0003.

## Context
We want Tailwind CSS and want to reuse the DoorSprint design system's styles (`doorsprint-app/client/app/assets/css`). We were also asked whether the code can be separated into "layers" the way Nuxt does it.

## Decisions
1. **Tailwind CSS v4** via `@tailwindcss/postcss` in `apps/web` (CSS-first config, no `tailwind.config.js`). CSS Modules are dropped: utilities replace them.
2. **Three-tier tokens, borrowed from DoorSprint:** primitives (`tokens.css`: raw palette and scales) -> semantic tokens per theme (`themes.css`: `--canvas`, `--surface`, `--fg`, `--brand`, status colours, glass fills) -> Tailwind utilities (`theme.css` maps semantic tokens to `bg-canvas`, `text-fg`, `rounded-control`, ...). Components only ever use semantic utilities.
3. **A design layer package, `packages/ui`**, holds those styles plus `materials.css` (glass/card surfaces), `base.css` and the **WCAG AA contrast test**. The app imports it with `@import '@dpt/ui/styles.css'` and tells Tailwind to scan it with `@source`.
4. **Theme is a server-set class from a cookie** (`theme=dark`), read in the root layout. No inline "anti-flash" script, so the CSP needs no script exception (ADR 0004) and there is no flash. Default is light. A system-preference mode would need duplicated dark tokens under a media query; deferred.
5. **Feature layering inside the web app:** `apps/web/src/features/<name>/` with a public `index.ts`. Lint forbids importing a feature's internals from outside (`**/features/*/*`), forbids import cycles, and forbids Supabase anywhere in web.

## What we kept, changed and dropped from DoorSprint
| | |
|---|---|
| Kept | Token architecture, light and dark themes, glass/card materials, radius scale, chart colours, the WCAG contrast test (it checks every text/surface pair in both themes, including translucent fills composited over the canvas). |
| Changed | `ai-*` tokens renamed `accent-*` (we have no assistant); comments stripped of product names; stylelint auto-fixes applied (`rgba` to `rgb`, hex length, blank lines); duplicate `backdrop-filter` removed (Tailwind adds the `-webkit-` prefix); small fixes in the contrast test to satisfy our lint rules (no behaviour change). |
| Dropped | shadcn-vue alias block, `tw-animate-css`, `shadcn-vue/tailwind.css`, `@nuxtjs/color-mode` references (Vue/Nuxt-specific). |
| Not wired by default | `.app-background` (animated ambient gradient, blur filter). Kept in `materials.css` but not applied: a calm, high-legibility surface suits a financial tool, and the blur costs GPU on low-end machines. |
| Note | The borrowed contrast test ignores the ambient gradient by design (glass fills are kept light enough to pass on the flat canvas). |

## Why
- **Tailwind + tokens** gives consistent, themeable styling with very little CSS to maintain, and oxfmt sorts the class names automatically.
- **Semantic tokens only** means a theme or brand change touches one file, and the contrast test protects accessibility for every change.
- **Reusing an existing design system** saves time and gives a tested accessible palette instead of one invented in a take-home.
- **Cookie theme** keeps the CSP strict.

## Can we layer like Nuxt? (the answer)
- **What Nuxt layers are:** a layer is a partial Nuxt app (components, composables, pages, plugins, layouts, server routes, config) pulled in with `extends`, from a folder, npm package or git repo, and merged automatically; a consumer can override pieces or disable a layer's modules.
- **Next.js has no equivalent.** There is no `extends`, no automatic merging of components or pages across packages, and App Router routes must live in the app's own `app/` directory.
- **What we can do, and do:** (1) workspace packages as layers: `packages/ui` (design) and `packages/shared` (contracts) consumed by the apps; (2) feature folders with public entry points and lint-enforced boundaries; (3) Tailwind's `@source` to scan layers outside the app (this is the same trick DoorSprint uses for its `layers/` folder).
- **What we cannot replicate:** automatic override/merge of pages or components between layers, and route contributions from a package.
- **Not done on purpose (YAGNI):** splitting each feature into its own package. Revisit if a second app consumes the same features.
- **Source (Nuxt side):** https://nuxt.com/docs/guide/going-further/layers. The statement that Next.js has no built-in equivalent is from general knowledge and a search that found no counter-example; confirm against current Next.js docs before presenting it as absolute.

## Risks
- Tailwind v4 requires the Tailwind-aware Stylelint config (done). The DoorSprint ambient background and glass effects are not applied by default.
- The `@source` path is relative (`../../../../packages/ui/src`), so moving files breaks class scanning silently; the build check (utilities present in CSS) catches it.

## Verified locally
Production build succeeds; generated CSS contains the token variables, `.dark`, the semantic utilities used by components, `.material-glass` (with `-webkit-` prefix restored), `sr-only` and the reduced-motion block; the full contrast matrix passes in both themes.
