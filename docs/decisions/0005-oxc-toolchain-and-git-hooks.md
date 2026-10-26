# ADR 0005: Oxc toolchain (oxlint, oxfmt) and git hooks

Status: accepted. Supersedes the ESLint + Prettier choice recorded in `CODING_STANDARDS.md` (now overlay exceptions E11 and E12).

## Context
Feature 00 first shipped with ESLint (typescript-eslint, strict type-checked), Prettier and Stylelint. Two things changed: the team wants the faster Oxc tools, and the stack hit a real problem: `typescript-eslint` 8.72 refused TypeScript 7.0, forcing us to pin TypeScript to 6.x.

## Decision
1. **Lint with oxlint** in type-aware mode (`oxlint --type-aware`, engine `oxlint-tsgolint@7`). **Format with oxfmt** (import sorting and Tailwind class sorting enabled). **Typecheck with `tsc --noEmit`** (TypeScript 7.0.2). **Stylelint stays** for CSS because Oxc does not lint CSS.
2. **Git hooks: Husky + lint-staged + commitlint.**
   - `pre-commit`: lint-staged runs `oxfmt`, `oxlint --type-aware --fix` and `stylelint --fix` on staged files only.
   - `commit-msg`: commitlint enforces Conventional Commits.
   - `pre-push`: `pnpm typecheck && pnpm test`.
   - Hooks are a convenience, not a gate: `--no-verify` bypasses them, so **CI is authoritative** (feature 00 part 2).

## Why
- **Removes the TypeScript pin.** tsgolint v7 is built on TypeScript 7.0.x, so dropping typescript-eslint lets us run TypeScript 7 (the native compiler). The earlier "pin to 6.x" debt is resolved.
- **Speed.** Oxc's own benchmarks claim 12-18x over ESLint + typescript-eslint on large repos. Our repo is tiny, so we do not claim a measured win; the benefit is headroom as it grows and fast hooks.
- **Coverage is sufficient for our rules.** Type-aware linting is stable and covers 59 of typescript-eslint's 61 type-aware rules (the two missing rules are not named in the announcement).
- **Husky + lint-staged** is the most widely adopted pairing and handles partially staged files safely (it stashes unstaged changes). Reviewers will recognise it.

## Alternatives considered
| Option | Why not |
|---|---|
| Keep ESLint + typescript-eslint + Prettier | Works, but blocks TypeScript 7 until typescript-eslint supports it; slower. |
| Biome | Not requested; would also replace the formatter but has its own gaps and no typescript-eslint-equivalent type-aware coverage comparable to tsgolint. |
| Lefthook (instead of Husky) | Good: single YAML, parallel, no lint-staged needed. Much smaller adoption (about 400K vs 5M weekly downloads, per one guide). Revisit if hook speed becomes a problem. |
| simple-git-hooks | No current monorepo evidence found. |

## What we verified locally (not just read)
- Every lint boundary rule fires under oxlint: Supabase blocked in web/shared and in the API outside `src/auth` and `src/db` (and allowed there), deep imports into a feature's internals blocked, `react/no-danger`, jsx-a11y click/keyboard rules, `it.only`, and type-aware `no-floating-promises`.
- The hooks block a bad commit message and a lint violation, and create no commit.
- `oxfmt --migrate=prettier` converted the Prettier config; import and Tailwind class sorting work.

## Gaps and quirks found (be honest about these)
- **oxfmt is beta** (announced Feb 2026; passes Prettier's JS/TS conformance suite; no Prettier plugin support; docs warn of edge-case differences). We could not confirm a stable release.
- **oxfmt lowercased font names** in CSS values (`Inter` became `inter`). Harmless (CSS family names are case-insensitive) but it shows the CSS formatter is not byte-identical to Prettier.
- **oxlint has no `no-restricted-syntax`.** The `dangerouslySetInnerHTML` ban therefore uses `react/no-danger` instead (same effect).
- Two typescript-eslint type-aware rules are not covered.
- `stylelint --fix` stripped hand-written `-webkit-backdrop-filter`; Tailwind (Lightning CSS) re-adds vendor prefixes, which we confirmed in the built CSS.

## Revisit when
oxfmt reaches 1.0 or produces a formatting bug on our code; a needed rule is missing from oxlint; hook time exceeds a few seconds.

## Sources
- Type-aware linting stable: https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
- oxfmt beta: https://oxc.rs/blog/2026-02-24-oxfmt-beta
- Hooks comparison (blog, indicative only): https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026
