/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Tailwind v4 at-rules.
    'at-rule-no-unknown': [
      true,
      { ignoreAtRules: ['theme', 'source', 'custom-variant', 'apply', 'utility', 'variant'] },
    ],
    // @apply takes utility class names, which stylelint cannot validate.
    'at-rule-prelude-no-invalid': [true, { ignoreAtRules: ['apply'] }],
    // Tailwind requires @import 'tailwindcss' first, then @source, then more imports.
    'no-invalid-position-at-import-rule': [true, { ignoreAtRules: ['source'] }],
    // Tailwind resolves bare-specifier string imports, not url().
    'import-notation': 'string',
    // Tailwind (Lightning CSS) adds vendor prefixes such as -webkit-backdrop-filter,
    // so none are written by hand.
    'property-no-vendor-prefix': true,
    // Tokens keep the comma form rgb(r, g, b, a) / percentage alpha from the
    // source design system; the contrast test parses exactly this form.
    'color-function-notation': null,
    'alpha-value-notation': null,
    'selector-max-id': 0,
    'declaration-no-important': true,
    'max-nesting-depth': 3,
    'selector-max-specificity': '0,3,0',
  },
};
