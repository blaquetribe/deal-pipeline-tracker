# ADR 0023: shared web control styling

Status: accepted
Date: 2026-10-29

## Context

The app uses the DoorSprint-derived semantic token layer, but buttons and form controls were styled with repeated Tailwind class strings. Dimensions, borders, hover states, and native select appearance varied across screens. DoorSprint's current control components are generated for Vue and use Reka UI; they cannot be imported into this React app.

## Decision

- Keep native HTML buttons and form controls for the current basic control set, and apply one shared control baseline from `packages/ui/src/styles/controls.css` using the existing light/dark semantic tokens.
- Keep layout and width in Tailwind utilities. Existing `bg-brand` intent marks primary buttons; other buttons use the shared secondary treatment. Standardize control height, radius, font, border contrast, select arrow, focus ring, hover, and disabled behavior.
- Do not add React UI dependencies just to reproduce the basic Button/Input/Select/Textarea primitives. Evaluate shadcn/ui components when a feature needs a complex interaction such as menus, popovers, or dialogs; use a vetted React implementation if the project adopts one.
- Keep reduced-motion behavior and native keyboard/accessibility semantics from the existing design layer.

## Consequences

Visual fixes to control shape and focus behavior now apply across pages and themes in one place. Feature markup still owns labels, field grouping, responsive layout, and primary-versus-secondary intent. The shared border token is covered by the contrast test at 3:1 in both themes.

## Verification

`packages/ui/src/styles/contrast.test.ts` checks control-border contrast in light and dark themes. Stylelint, web component tests, and visual review cover the implementation.
