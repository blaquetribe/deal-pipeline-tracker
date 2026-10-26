# Markup Standards (HTML in JSX, and HTML email templates)

Applies to every JSX/TSX that renders HTML in `apps/web`, and to HTML emails rendered in `apps/api`. Extends ENGINEERING_STANDARDS §4.6 (accessibility) and SECURITY_STANDARDS. Rule words: MUST / SHOULD / MAY as in the base.

## 1. Semantics first
- Use the element that matches the meaning: `button` for actions, `a href` for navigation, `form`, `label`, `table`, `ul/ol`, `nav`, `main`, `header`, `footer`, `section` (with a heading), `article`, `time`, `dl` for key/value facts.
- Every page has exactly one `main`, one `h1`, and non-skipping heading order. A "skip to content" link is the first focusable element.
- MUST NOT put `onClick` on a `div`/`span`. MUST NOT use `a` without `href` or `button` for navigation.
- `<html lang>` set. Document `title` per route. `time dateTime` for dates (ISO).
- No presentational markup (`<b>`, `<br>` for spacing, empty elements for layout). Layout is CSS.

## 2. Accessibility (WCAG 2.2 AA)
- All interactive elements keyboard-operable with visible focus (`:focus-visible`), logical tab order, no positive `tabindex`.
- Accessible names: visible text first; `aria-label` only when there is no visible text. Prefer native semantics over ARIA; add ARIA only where native HTML cannot express it.
- Icon-only buttons have an accessible name; decorative icons are `aria-hidden`. Images have meaningful `alt` or `alt=""`.
- Status is never conveyed by colour alone: stage badges, approval states and errors carry text (and icon where useful).
- Dialogs: native `<dialog>` or a vetted accessible primitive; focus moves in, is trapped, restores on close; Escape closes.
- Respect `prefers-reduced-motion`.

## 3. Forms
- Every control has a programmatically associated `<label>` (`htmlFor`/`id` via `useId`, never hand-typed ids).
- Correct `type`, `autocomplete` (`email`, `current-password`, `new-password`, `one-time-code`), `inputmode`, `required`, and constraints. Password fields allow paste and password managers.
- Validation errors: text next to the field, linked with `aria-describedby`, `aria-invalid="true"`; an error summary at the top receives focus on failed submit. Client validation reuses the shared zod schema and is UX only; the server is authoritative.
- Submit buttons show pending state and are disabled while pending; double submit must be harmless (idempotent server side).
- Money inputs: text input with `inputmode="decimal"`, parsed to integer minor units by one shared function (never `parseFloat` on amounts).

## 4. Data views (pipeline, deal lists, ledger)
- Tabular data uses `table` with `caption`, `th scope`, and sortable headers as `button`s with `aria-sort`.
- The pipeline board (if kanban) MUST have a keyboard-and-screen-reader path to move a deal between stages (a "Move to..." menu/control); drag and drop is an enhancement, never the only way.
- Timeline/ledger is an ordered list (`ol`) of events with `time` elements; amended events are linked to the original, not visually replaced.
- Every list/query view has distinct empty, loading (skeleton with `aria-busy`), and error states with retry.

## 5. Realtime and live regions
- Live updates MUST NOT steal focus or reorder content under the cursor without notice. Announce meaningful changes via a single polite `aria-live="polite"` region ("Deal Atlas moved to IC Review"); use `assertive` only for errors that block work.
- Batch bursts of events into one announcement. Presence indicators have text equivalents.
- Connection status ("Reconnecting...") is exposed as text in a status region.

## 6. React/Next component rules
- One component per file; PascalCase component files, kebab-case for everything else (base §2.2). Props typed explicitly; no `any`; no spreading unknown props onto DOM elements.
- Stable `key`s from ids, never array index for reorderable lists.
- No `dangerouslySetInnerHTML` (security). User text (notes, names) renders as plain text only.
- No inline `style` except to set a CSS custom property for a dynamic value. Styles come from CSS Modules and tokens (overlay E3).
- No direct DOM manipulation; effects only for synchronisation with external systems; derived state is computed, not stored.
- Links to external sites: `rel="noopener noreferrer"`. Internal navigation via the framework `Link`.
- Use `data-testid` only when no role/label/text query is possible (see TESTING_STANDARDS).

## 7. Email templates (verification, invitation)
- Templates are typed pure functions in `apps/api/src/email/templates`: `renderXxxEmail(props): { subject: string; html: string; text: string }`. Always produce both HTML and plain text.
- All interpolated values are HTML-escaped by one shared helper; no raw string concatenation of user input (tenant names, inviter names are user-controlled).
- Table-based layout with inline styles (email clients ignore most CSS), max width about 600px, system font stack, no remote images or scripts, sufficient contrast, meaningful link text, a preheader.
- Links are built from configured absolute base URLs; the one-time token appears only in the link and is never logged. State expiry in the copy.
- Invitation email names the inviter (verified email) and states that the organisation name is self-declared.
- Tests: unit tests assert escaping (e.g. `<script>` in a tenant name), presence of the text part, and link shape; the Mailpit inbox is the manual check.

## 8. Avatars and images
- The avatar component renders an `img` (served by the BFF at `/api/users/:id/avatar?v=<hash>`) or generated initials. Initials are decorative (`aria-hidden`) when the person's name appears as text beside them; otherwise the avatar has an accessible name.
- Initials colours come from tokens and meet AA contrast; colour is deterministic per user id.
- Images set `width`/`height` to avoid layout shift, `alt=""` when decorative, and `loading="lazy"` below the fold. Image sources are same-origin only (CSP `img-src 'self' data: blob:`).
- Upload UI: a labelled file input with accepted types and size shown as text, progress and errors announced in a live region, and preview via `blob:` URL revoked on unmount.

## 9. Checklist (copy into PRs touching markup)
- [ ] Semantic elements; one `main`/`h1`; heading order correct
- [ ] Keyboard path and visible focus for every interaction
- [ ] Labels, errors, `autocomplete` on forms
- [ ] Status not by colour alone
- [ ] Empty/loading/error states present
- [ ] Live-region behaviour considered for realtime changes
- [ ] No `dangerouslySetInnerHTML`, no inline styles
- [ ] Email: escaped values, text part, no remote assets
