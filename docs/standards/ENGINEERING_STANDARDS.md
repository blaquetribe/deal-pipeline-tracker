# Engineering Coding Standards

**Applies to:** TypeScript, JavaScript interoperability, CSS, SCSS, frontend applications, backend services, shared packages, and tooling.  
**Status:** Normative engineering standard  
**Version:** 1.0  
**Rule language:** **MUST** = mandatory; **SHOULD** = default with documented exception; **MAY** = optional.

> **Core philosophy:** Convention over configuration, simplicity over cleverness, explicit contracts over assumptions, composition over inheritance, maintainability over short-term speed. Apply DRY and SOLID pragmatically; never abstract merely to satisfy an acronym.

## 1. Governing principles

1. **Convention over configuration:** Prefer established framework conventions and predictable structure. Introduce configuration only for a genuine product or deployment variation, not to compensate for inconsistent implementation.
2. **Single source of truth:** Each domain concept, invariant, design token, and contract has one authoritative definition. Avoid duplicated business decisions.
3. **SOLID, contextually:** Keep modules cohesive, extend through stable boundaries, depend on abstractions at integration edges, and avoid bloated interfaces. Favor functions and composition unless classes materially improve design.
4. **DRY without premature abstraction:** Duplicate trivial syntax is often cheaper than coupling unrelated modules. Consolidate repeated *knowledge*, rules, and business logic after identifying a stable common concept.
5. **KISS and YAGNI:** Build the simplest clear solution for current requirements. Do not implement speculative extension points, generic frameworks, or unused configuration.
6. **Correctness by construction:** Strict types, validated inputs, deterministic behavior, explicit errors, and tests around critical invariants.
7. **Accessible, responsive, secure by default:** Accessibility, privacy, security, and performance are acceptance criteria, not cleanup work.
8. **Consistency wins:** Existing project conventions prevail when coherent and documented. Deviations require an ADR or code-review rationale.

### 1.1 Decision precedence

When principles conflict, prioritize: correctness and security → accessibility and data integrity → readable intent → domain cohesion → maintainability → performance evidence → brevity. Performance exceptions MUST be measured.

### 1.2 Exception policy

Any deviation from a **MUST** rule requires a short explanation in the PR, the scope of impact, and a follow-up issue if temporary. Exceptions MUST NOT silently spread into project convention.

---

## 2. Repository and module organization

### 2.1 Organize by feature/domain

**SHOULD** group application logic by business capability rather than globally grouping everything into `services/`, `utils/`, and `types/`. Follow framework-specific directory rules when they exist.

```text
src/
  app/                  # bootstrap, routing, dependency wiring
  features/
    approvals/
      api/
      components/
      domain/
      infrastructure/
      tests/
      index.ts
  shared/
    ui/
    lib/
    styles/
      tokens.scss
      globals.scss
```

- Feature internals MUST remain private unless explicitly exported through the feature's public `index.ts`.
- Shared code MUST have at least two genuine consumers or represent a deliberately shared cross-cutting contract.
- Avoid circular dependencies. Dependency direction SHOULD be UI/API → application orchestration → domain; infrastructure implements contracts at the edges.
- Use framework conventions for entry points, file-based routing, naming, build output, middleware and configuration instead of inventing parallel conventions.
- Do not create a folder or abstraction for a single trivial file without a clear reason.

### 2.2 Naming conventions

| Element | Convention | Example |
|---|---|---|
| Variables/functions | `camelCase` | `isLocaleValid`, `loadApprovals` |
| Types/interfaces/classes/enums | `PascalCase` | `ApprovalPolicy`, `GateStatus` |
| Constants | `camelCase`; `UPPER_SNAKE_CASE` only for true global/environment constants | `defaultTimeoutMs`, `MAX_UPLOAD_BYTES` |
| Boolean identifiers | `is`, `has`, `can`, `should` prefix | `isArchived`, `canApprove` |
| Event handlers | `handle` for local handlers; `on` for callback props | `handleSubmit`, `onSubmit` |
| TypeScript filenames | `kebab-case.ts`; UI component files may use framework convention | `approval-policy.ts`, `ApprovalCard.vue` |
| CSS classes | semantic `kebab-case`, namespaced by component/feature when needed | `.approval-card__title` |
| CSS custom properties | `--domain-purpose` | `--color-text-primary` |
| SCSS variables/mixins/functions | `$kebab-case`, `@mixin kebab-case` | `$spacing-unit`, `@mixin focus-ring` |
| Test files | same stem with `.test.ts` or `.spec.ts` (choose once per repo) | `approval-policy.test.ts` |

- Names MUST describe behavior or domain meaning. Avoid `data`, `temp`, `helper`, `manager`, `stuff`, and acronyms not established by the domain.
- Do not prefix interfaces with `I` (use `ApprovalPolicy`, not `IApprovalPolicy`).
- Avoid Hungarian notation and type information in variable names unless it disambiguates units (e.g., `timeoutMs`).

### 2.3 Imports and exports

- Use ES module syntax. Prefer named exports; use default exports only when framework conventions require them.
- Use `import type` for type-only imports when appropriate; enforce via compiler/linter.
- Sort/group imports automatically with one configured formatter/linter. Do not debate formatting in code reviews.
- Avoid deep imports into another feature's internals and uncontrolled barrel exports.
- Prefer aliases only when they simplify imports predictably; document aliases centrally.

---

## 3. TypeScript rules

### 3.1 Compiler baseline

**MUST** enable `strict` for all newly authored TS projects. Recommended baseline (adapt module settings to the runtime/framework):

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`noEmit` is appropriate when a bundler or separate build pipeline emits output; library or Node compilation pipelines may need a different setting. `skipLibCheck` is a pragmatic default, not permission to ignore broken public types. Configure `target`, `module`, and `moduleResolution` for the actual runtime, not by copy-paste.

### 3.2 Types and contracts

- MUST NOT introduce explicit `any` except at documented, isolated interoperability boundaries with an immediate narrowing plan. Prefer `unknown` for untrusted or uncertain data.
- MUST NOT use `// @ts-ignore` as a routine fix. If truly necessary, use `@ts-expect-error` with an explanation and a tracked issue where appropriate.
- Prefer inference for local values; annotate public APIs, exported functions, and important domain boundaries when it improves clarity.
- Prefer discriminated unions for mutually exclusive states; never represent impossible state combinations through unrelated booleans.
- Prefer `readonly` for immutable properties and immutable array views where mutation is not intended.
- Prefer `type` for unions, mapped types, and type composition; prefer `interface` for extendable object contracts when useful. Avoid rigid dogma where either is clear.
- Avoid non-null assertions (`!`) without a proven runtime invariant.
- Use `satisfies` when checking object shape while preserving inference.
- Distinguish absent, `null`, and empty values intentionally.
- Never claim compile-time types validate runtime API, database, or environment inputs.

```ts
// Good: a finite, explicit state model.
type ApprovalState =
  | { status: "pending" }
  | { status: "approved"; approvedBy: string; approvedAt: Date }
  | { status: "rejected"; reason: string };
```

### 3.3 Functions

- Each function SHOULD perform one cohesive task and have a clear name describing its effect.
- Prefer pure functions for transformations and domain rules; separate I/O from decision-making.
- Prefer early returns and guard clauses to heavily nested conditionals.
- Prefer parameter objects when inputs are numerous, optional, or easy to confuse; do not create an object wrapper for every two-argument function.
- Boolean arguments that obscure intent SHOULD be replaced by descriptive options or separate operations.
- Use `async`/`await` consistently for asynchronous orchestration. Never leave promises unhandled.
- Avoid side effects in predicates and getters.
- Minimize mutation scope; default to `const`, use `let` only when reassignment is required, never use `var`.

```ts
const LOCALE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isLocaleValid(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && LOCALE_PATTERN.test(value))
  );
}

// Invalid input is handled at the boundary.
if (!isLocaleValid(requestBody.locale)) {
  throw new ValidationError("Invalid locale");
}
```

**Important:** A type predicate does not replace validation of the surrounding object. Read `requestBody` as `unknown` and validate its shape before accessing properties. This validator considers `undefined` valid because the field is optional; change that policy if the field is required.

### 3.4 Runtime validation and trust boundaries

- Treat network payloads, URL parameters, environment variables, form values, files, database JSON, and third-party responses as untrusted.
- Validate at the ingress boundary with explicit guards or a shared schema library (e.g., Zod/Valibot if already used in the repository).
- Normalize once after validation; pass validated domain types inward.
- Validate both syntax and domain semantics (e.g., a syntactically correct locale may still be unsupported).
- Keep transport DTOs separate from domain entities when their constraints differ.
- Do not silently coerce identifiers with `String(value)` unless coercion is an explicit API requirement.

### 3.5 Error handling

- Use meaningful typed/domain errors for expected failures; avoid returning arbitrary `null`/`false` from complex operations without a documented contract.
- Never swallow exceptions silently, log and rethrow the same error at every layer, or disclose secrets in errors.
- Translate errors into HTTP/UI responses only at the relevant boundary.
- Preserve original causes where supported (`new Error(message, { cause })`).
- Use structured logs with correlation IDs; redact tokens, passwords, PII, and sensitive payloads.

### 3.6 Async and resource management

- Handle cancellation via `AbortSignal` where the platform supports it.
- Set explicit timeouts and retry policies for external I/O. Retry only safe/idempotent operations or with idempotency keys.
- Avoid sequential `await` when independent work can safely run concurrently; use controlled concurrency rather than unlimited fan-out.
- Ensure cleanup for subscriptions, timers, streams, listeners, and open connections.

### 3.7 Domain modeling and state

- Prefer explicit domain vocabulary and types rather than passing generic maps across layers.
- Make state ownership clear. Derived state SHOULD be calculated, not duplicated and synchronized.
- Keep business rules outside controllers, components, and persistence adapters.
- Use finite-state transitions for consequential workflows (approvals, publishing, payments, archiving).
- Make authorizations server-side and distinct from UI visibility.

### 3.8 SOLID in TypeScript

| Principle | Required engineering behavior | Common misuse |
|---|---|---|
| **S**ingle Responsibility | A module has one coherent reason to change | Splitting every tiny function into a separate file |
| **O**pen/Closed | Extend stable behavior through composition/strategy when real variants exist | Building plugin systems before a second implementation exists |
| **L**iskov Substitution | Implementations honor the full documented contract | Subclasses that narrow valid inputs or throw unexpectedly |
| **I**nterface Segregation | Consumers depend on narrow, useful contracts | Massive service interfaces with unrelated operations |
| **D**ependency Inversion | Domain/application rules depend on contracts, not vendors | Dependency-injection frameworks for trivial local helpers |

```ts
interface ApprovalRepository {
  getApprovals(gateId: string): Promise<readonly string[]>;
}

interface ApprovalPolicy {
  minimumApprovals: number;
  eligibleApprovers: readonly string[];
}

function hasReachedThreshold(
  approvals: readonly string[],
  policy: ApprovalPolicy,
): boolean {
  const eligible = new Set(policy.eligibleApprovers);
  const distinctValidApprovals = new Set(
    approvals.filter((approver) => eligible.has(approver)),
  );

  return (
    policy.minimumApprovals >= 1 &&
    policy.minimumApprovals <= eligible.size &&
    distinctValidApprovals.size >= policy.minimumApprovals
  );
}
```

This example intentionally models only the numeric threshold, **not** vetoes, abstentions, conflicts of interest, delegated authority, membership changes, or audit policy. Those rules require explicit domain design.

---

## 4. CSS and SCSS rules

### 4.1 CSS architecture

- Use **plain CSS first**. Use SCSS when nesting, mixins, functions, or modular organization provide measurable clarity; avoid using SCSS solely for variables now supported by CSS custom properties.
- Prefer component-scoped styles or CSS Modules/framework-scoped CSS according to the stack. Reserve global CSS for reset, typography baseline, design tokens, and shared utilities.
- Use cascade layers where practical: `reset`, `tokens`, `base`, `components`, `utilities`, `overrides`.
- Avoid styling by element nesting or DOM position when a semantic class would be stable.
- Prefer documented component variants and state attributes (`data-state`, `aria-*`) over brittle selectors.
- Avoid `!important` except tightly controlled utility/override layers with justification.
- Keep specificity low; avoid ID selectors for styling and long selector chains.

### 4.2 Design tokens: one source of truth

- Define colors, spacing, radii, typography, breakpoints, shadows, and motion as design tokens.
- **CSS custom properties** SHOULD be the runtime source of truth for theming and dynamic variants. SCSS variables MAY support compile-time loops or tooling.
- Never scatter magic color values or spacing values through component styles unless deliberately local.
- Prefer semantic tokens (`--color-surface`, `--color-text-danger`) over raw presentation names (`--dark-blue`) at consumption sites.
- Token changes SHOULD be backward-compatible or versioned when consumed by multiple packages.

```scss
@layer tokens {
  :root {
    --color-surface: #fff;
    --color-text: #17212b;
    --color-border: #d7dde3;
    --color-focus: #165dce;
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --radius-md: 0.5rem;
  }
}
```

### 4.3 Selector conventions

Use a consistent, documented component naming strategy. Recommended: **BEM-inspired** names for global styles (`block__element--modifier`), while scoped/module styles may use concise semantic names. Do not mix naming methodologies within the same styling context.

```scss
@layer components {
  .approval-card {
    padding: var(--space-4);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);

    &__title {
      margin-block: 0 var(--space-2);
    }

    &--compact {
      padding: var(--space-2);
    }

    &:focus-visible {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }
  }
}
```

`focus-visible` belongs on an element that can actually receive focus; for a non-focusable container, style its relevant interactive children or use `:focus-within` when appropriate.

### 4.4 SCSS practices

- **MUST** use modern Sass module syntax: `@use` and `@forward`, not legacy `@import`.
- **SHOULD** keep nesting at **three levels or fewer** (including pseudo-classes where sensible); avoid selectors that depend on deep markup hierarchy.
- Mixins SHOULD encapsulate repeated rule sets requiring parameters or complex fallbacks; do not create mixins for single ordinary properties.
- Functions SHOULD perform pure compile-time calculations; avoid opaque numeric tricks.
- Limit global mixins/functions to stable design-system concerns. Namespace imports with `@use ... as name` rather than `as *` by default.
- Use `@extend` sparingly; it can create unexpected coupled selectors. Prefer mixins or shared classes for intentional reuse.
- Keep partials focused and avoid cyclic Sass modules.

```scss
// styles/_a11y.scss
@mixin focus-ring {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

// approval-button.scss
@use "../styles/a11y" as a11y;

.approval-button:focus-visible {
  @include a11y.focus-ring;
}
```

### 4.5 Layout and responsive design

- Prefer modern **Flexbox/Grid** over floats, arbitrary absolute positioning, and layout-by-margins.
- Use logical properties (`margin-inline`, `padding-block`, `inset-inline-start`) to support internationalization.
- Prefer fluid layouts, `minmax()`, `clamp()`, relative units, and intrinsic sizing where appropriate.
- Responsive breakpoints MUST correspond to layout needs, not device brand names.
- Consider container queries for reusable components whose width depends on their container.
- Avoid fixed heights for text-heavy or localized content.
- Prevent horizontal overflow and test at narrow widths and zoomed text settings.

### 4.6 Accessibility and interaction

- Text and interactive content MUST meet project accessibility targets; default target is **WCAG 2.2 AA** where applicable.
- Do not remove focus indicators without an equivalent accessible replacement.
- Respect `prefers-reduced-motion`; animations must not gate functionality.
- Avoid using color alone to communicate state.
- Ensure touch targets, visible labels, validation feedback, and keyboard interaction are usable.
- Avoid pseudo-elements for essential textual content or accessible names.
- Support high zoom, dark mode/high contrast when required by the product, and right-to-left layouts where supported.

```scss
.notification-enter {
  transition: opacity 180ms ease, transform 180ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .notification-enter {
    transition: none;
  }
}
```

### 4.7 Performance

- Prefer selectors with understandable scope over expensive, complex relational selectors in frequently updated trees.
- Animate `transform` and `opacity` where possible; avoid continuous layout-triggering animation.
- Do not ship unused global styles or duplicate framework resets.
- Prefer SVG for scalable icons, responsive images for photography, and sensible font loading strategies.
- Evaluate visual regressions and CSS bundle size in significant design-system changes.

---

## 5. Conventions over configuration

- Establish a small **project convention registry**: file naming, exports, route naming, validation, DTO mapping, errors, testing, styling, tokens, logging, and environment variables.
- Prefer framework-default plugins, lifecycle hooks, middleware, naming, and directory conventions unless there is a concrete reason not to.
- Configuration MUST be centralized, documented, typed/validated, environment-appropriate, and minimal.
- Do not expose a feature flag for behavior that is permanently fixed by domain policy.
- Every configuration field needs a clear owner, default, acceptable values, and failure behavior.
- Avoid feature-specific configuration formats when existing typed configuration patterns are sufficient.

### 5.1 Example: approval gates

Model the *domain requirement* of configurable `k-of-N` approval explicitly rather than adding arbitrary switches:

```ts
type GateApprovalPolicy = {
  gateId: string;
  eligibleApproverIds: readonly string[];
  minimumApprovals: number;
  rejectionPolicy: "blocks" | "record-only";
};
```

- Validate `1 <= minimumApprovals <= count(distinct eligibleApproverIds)`.
- Specify whether rejected votes, abstentions, delegation, or committee changes affect the outcome.
- `minimumApprovals === eligibleApproverIds.length` represents unanimity **only if the eligible members and other decision rules define unanimity that way**.
- Store an auditable decision history; never rely solely on a mutable current tally.

---

## 6. DRY and reusable code

**Abstract shared knowledge; do not chase zero duplicated lines.**

A shared abstraction SHOULD satisfy all three:
1. The consumers share the same **semantic rule**, not merely similar syntax.
2. Changes to the rule should logically change every consumer together.
3. The shared API is simpler than maintaining the instances separately.

- Centralize validation schemas, domain policies, authorization rules, and design tokens.
- Prefer modest, composable utilities over monolithic `CommonService` or `BaseController` hierarchies.
- A little duplication is acceptable when it preserves independent evolution between domains.
- Avoid generic repositories/services unless common behavior is stable and real.
- Do not duplicate backend authorization logic in a way that makes frontend checks authoritative; the frontend may mirror it for UX only.

---

## 7. Architecture boundaries

### 7.1 Presentation, application, domain, infrastructure

- **Presentation:** render UI, collect input, display states; no hidden business policy.
- **Application:** coordinate workflows, transactions, authorization requests, and I/O; limited decision logic.
- **Domain:** business invariants and calculations, ideally runtime-framework-independent.
- **Infrastructure:** databases, APIs, message queues, files, logging, cloud SDKs.

Boundaries MAY be combined for small features if separation would add ceremony with no benefit. The rule is **clear ownership**, not a mandated folder count.

### 7.2 API and data contracts

- APIs MUST have consistent request/response envelopes or follow established framework conventions consistently.
- Use meaningful HTTP status codes, standardized error codes, pagination semantics, idempotency behavior, and versioning policies.
- Reject invalid inputs at boundaries with actionable, safe messages.
- Ensure date/time precision and timezone conventions are explicit; use ISO 8601 at interfaces where applicable.
- Money MUST use integer minor units or a deliberate decimal representation; never floating-point arithmetic for monetary correctness.
- Database writes that enforce multi-step invariants SHOULD use transactions.
- Audit sensitive transitions (approval, archive, restore, payment, permission change) with who/what/when/context.

### 7.3 Security

- Authenticate and authorize on the server for every protected operation.
- Default to least privilege and tenant isolation across every data access path.
- Use parameterized queries and output encoding; never concatenate untrusted SQL or HTML.
- Keep secrets out of source control, logs, build artifacts, and browser bundles.
- Validate uploads: type, size, content, storage permissions, and malware controls appropriate to risk.
- Pin and review dependencies; use automated vulnerability scanning and an upgrade cadence.
- Protect against CSRF, XSS, SSRF, injection, mass assignment, and insecure direct object references according to the architecture.

---

## 8. Testing standards

### 8.1 Test priorities

1. **Unit tests** for pure domain rules, validation, calculations, and state transitions.
2. **Integration tests** for data access, APIs, auth, framework hooks, and dependency adapters.
3. **End-to-end tests** for critical journeys (authentication, approvals, publish/archive/restore, purchases when applicable).
4. **Accessibility and visual regression checks** for shared UI components and critical screens.

- Tests MUST assert observable behavior, not implementation details.
- Every bug fix SHOULD include a failing regression test that passes after the fix.
- Test valid, invalid, empty, boundary, duplicate, and permission-denied cases.
- Use deterministic fixtures, isolated data, and controlled time. Avoid sleep-based tests.
- Mocks are for boundaries and difficult dependencies, not for hiding broken integrations.
- Coverage thresholds are a backstop, not proof of quality. Prioritize meaningful coverage of risks.

```ts
import { describe, expect, it } from "vitest";
import { isLocaleValid } from "./locale";

describe("isLocaleValid", () => {
  it.each([undefined, "en", "en-US", "pt_BR"])(
    "accepts %s",
    (value) => expect(isLocaleValid(value)).toBe(true),
  );

  it.each([null, "", "en US", 42, {}])(
    "rejects %s",
    (value) => expect(isLocaleValid(value)).toBe(false),
  );
});
```

These examples test only the syntactic policy, not whether the locale is enabled in a real deployment.

### 8.2 Definition of done for change types

| Change | Minimum verification |
|---|---|
| Pure utility/domain rule | unit tests with edge cases |
| API/controller | request validation, authorization, success/error integration tests |
| Data model or migration | migration forward/backward strategy, integrity checks |
| UI component | interaction, accessibility, responsive/visual states |
| Shared tokens/styles | visual regression on affected consumers |
| Security-sensitive workflow | negative permission and tenant-isolation tests |

---

## 9. Tooling and automation

All repositories MUST provide reproducible scripts (adjust names to existing workspace conventions):

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "stylelint": "stylelint \"src/**/*.{css,scss}\"",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

These are **illustrative scripts**, not universal package requirements. If the project uses framework-specific type checks (e.g. `vue-tsc`), another test runner, or an integrated lint/format solution, use the supported equivalent. Avoid two tools enforcing conflicting formatting rules.

### 9.1 Required quality gates

- Format check
- Typecheck
- Lint (TS/JS and CSS/SCSS)
- Unit and relevant integration tests
- Build validation
- Dependency/security scanning appropriate to the project
- Accessibility and E2E checks for relevant changes

CI MUST fail on mandatory gate failures. Do not introduce broad lint disables or `|| true` workarounds to make builds green.

### 9.2 Suggested lint policy

- Enforce no unused variables/imports, no floating promises, safe type handling, no duplicate imports, consistent type imports, and no unnecessary assertions.
- Enforce selector specificity discipline, SCSS module syntax, valid CSS property values, token usage conventions, and reasonable nesting.
- Use ESLint (with typescript-eslint) and Stylelint with compatible maintained plugins, or a documented equivalent.
- Prefer formatter ownership of stylistic details (quotes, semicolons, line width) over manual comments in PRs.
- Pin tool versions through the lockfile and project tooling; document Node/package-manager requirements.

---

## 10. Documentation and comments

- **Code explains what; comments explain why.** Avoid narrating obvious statements.
- Document exported public APIs when behavior, constraints, side effects, or errors are not evident from types.
- Include examples in reusable components/libraries when usage is non-obvious.
- Keep architectural decisions in short ADRs: context, decision, alternatives, consequences.
- Maintain setup instructions, environment variable documentation, and migration notes.
- Update documentation and tests in the same change as behavior.
- Do not leave stale TODOs without owner/issue context for consequential work.

---

## 11. Git, pull requests and code review

- Prefer small, cohesive PRs that can be reasoned about and rolled back.
- Each PR SHOULD state intent, behavior change, test evidence, risks, and migration/rollout notes where relevant.
- Include screenshots or screen recordings for visually significant UI changes.
- Request review from code owners for shared contracts, critical paths, and domain policy changes.
- Reviews MUST check behavior, maintainability, test evidence, authorization, accessibility, and unintended scope changes—not just style.
- Never merge knowingly failing required CI checks without a documented incident process.
- Use conventional commits if adopted repo-wide; consistency matters more than any particular format.
- Do not silently refactor unrelated modules during a feature or bug-fix PR.

### 11.1 Review checklist

- [ ] Does the change solve the stated problem without unrelated scope?
- [ ] Does it follow existing framework and repository conventions?
- [ ] Are naming, module ownership, and public APIs understandable?
- [ ] Are runtime inputs validated, permissions enforced, and errors safe?
- [ ] Is business logic in the correct layer and is there a single source of truth?
- [ ] Are DRY/SOLID applied appropriately without speculative abstraction?
- [ ] Are TypeScript types strict and are unsafe casts justified?
- [ ] Are styles tokenized, scoped, accessible, responsive, and low-specificity?
- [ ] Are relevant tests present, deterministic, and meaningful?
- [ ] Does CI pass and is the rollback/migration risk understood?

---

## 12. Explicit anti-patterns

**Prohibited or strongly discouraged unless justified:**

- `any` chains, unchecked casts, non-null assertions used to silence known errors.
- Repeated business-policy implementations in controllers, UI components, and services.
- God objects, mega-components, giant services, and catch-all `utils.ts` files.
- Inheritance trees where composition or ordinary functions suffice.
- Premature reusable frameworks, hidden magic decorators, and unexplained config flags.
- Broad catch blocks returning success-like values or swallowing errors.
- Direct DOM manipulation when the UI framework owns the DOM.
- Global mutable state without clear ownership or synchronization.
- CSS ID selectors, deeply nested selectors, uncontrolled `!important`, magic z-index numbers.
- Copy-pasted colors/spacing rather than design tokens.
- Extensive `@extend`, deprecated Sass `@import`, and unscoped utility proliferation.
- Tests that verify only mocks or implementation internals.
- Disabling lint/typecheck/test gates to complete a task.

---

## 13. Adoption plan for existing repositories

1. **Inventory** current conventions, TypeScript compiler settings, SCSS architecture, lint tools, and build/test pipelines.
2. **Agree on defaults** and record repo-specific exceptions in `docs/engineering/conventions.md` or an ADR.
3. **Automate formatting first** to avoid stylistic review churn.
4. **Add lint/typecheck/stylelint in stages**; prevent new violations before attempting large migrations.
5. **Create canonical templates** for feature modules, validation, API endpoints, UI components, tests, and tokens.
6. **Refactor opportunistically** around active feature work; avoid blanket rewrites with no functional benefit.
7. **Measure** CI reliability, defects, change lead time, code review friction, and accessibility regressions; revisit ineffective rules.

### 13.1 Per-project extension file

Projects SHOULD keep a short `CONVENTIONS.md` stating:

```md
# Project Conventions
- Runtime/framework versions:
- Package manager and lockfile:
- Naming and directory conventions:
- Lint/formatter/typecheck commands:
- Styling approach (CSS Modules / scoped styles / BEM / utility CSS):
- Design token authority:
- Test runner and integration test harness:
- API error/validation standard:
- Exceptions to organization-wide standards (with ADR links):
```

---

## 14. Non-negotiable summary

1. **Follow framework and repo conventions.** Do not reinvent structure without a reason.
2. **Use strict TypeScript and validate untrusted runtime data.** Types are not validation.
3. **Keep domain rules centralized and dependencies directed.** Apply SOLID through cohesive boundaries and composition.
4. **Use DRY for duplicated knowledge, not incidental matching lines.** Avoid premature abstraction.
5. **Use semantic CSS, tokens, scoped selectors, accessible interaction, and modern Sass modules.**
6. **Write meaningful tests and enforce quality gates in CI.** Never disguise failures.
7. **Make changes explicit, reviewable, observable, and reversible.**

*This standard is intentionally framework-agnostic. Repository-specific framework rules supplement it, but MUST NOT weaken correctness, security, runtime validation, or accessibility requirements without a documented exception.*
