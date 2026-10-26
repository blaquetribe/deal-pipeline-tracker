# ADR 0012: Code coverage

Status: accepted and implemented.

## Decision
- **Provider: V8** (`@vitest/coverage-v8`), merged across all Vitest projects (web, api, shared, ui, scripts) from the root config.
- **Count every source file**, not only files a test happened to load (`coverage.include` over `apps/*/src` and `packages/*/src`), so untested code appears as 0% and cannot hide.
- **Thresholds fail the build:** globally 90% statements, lines and functions and 85% branches; **95/90/95/95 for `packages/shared` and `apps/api/src`**, where the domain contracts and the security-relevant logic live.
- **Exclusions are few and justified in the config:** the API entry point (starts the server; proven by the compose smoke test) and the async `layout.tsx` Server Component (Vitest cannot render it; its logic lives in `features/theme`, which is tested).
- **Reports:** `text-summary`, per-file `text`, `html`, `lcov` and `json-summary`. CI writes a Markdown summary to the job page (`scripts/coverage-summary.mjs`) and uploads the HTML report as a 14-day artifact, even when a threshold fails.

## Why V8 and not Istanbul
Evidence, not reputation: I ran **both providers on our code** and compared. Results were **identical** on every file with executable code (19/19 statements, 2/2 branches, 9/9 functions, 18/18 lines); the only difference was that Istanbul omits files with nothing to execute. V8 needs no instrumentation transform and is already installed. **Honest limit:** our code is still tiny, so this is a weak test of edge-case branch semantics (optional chaining, default parameters). The comparison is cheap to repeat as the code grows (temporarily add `@vitest/coverage-istanbul`, run with `--coverage.provider=istanbul`); switching providers is a one-line change.

## What the first run taught us
The earlier setup reported **100%** coverage but counted only 19 statements, and **one of the counted files was the test setup file itself**, while the app's untested code (entry point, layout, page) was invisible. Counting all files exposed that, and a planted untested file in `apps/api` now fails the build with specific errors (statements 76%, branches 33%, below both the global and API thresholds).

## What coverage does not tell us
Coverage says which lines ran, not whether tests would catch a bug. A test with no assertions gives 100%. So it is a **backstop against regressions, not a quality measure**.

## Next step (extended tier): mutation testing
Mutation testing (for example Stryker with the Vitest runner) changes the code on purpose and checks that tests fail; its "mutation score" measures test quality. Scope it to the domain code where mistakes are costly: the stage-machine mirror, quorum and separation-of-duties logic, token generation, and the closing-soon date maths. We already did this by hand for the AI-review scripts (breaking two behaviours made the matching tests fail). Not installed yet: it is slow and only pays off once that domain code exists.

## Alternatives considered
- **Istanbul:** no measured benefit today; kept as a documented one-line switch.
- **Hosted services (Codecov, Coveralls):** a third party would read the code and need a token; no benefit over the CI summary and artifact for this project.
- **No thresholds, report only:** rejected; a number nobody enforces drifts.
