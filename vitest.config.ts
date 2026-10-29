import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/web', 'apps/api', 'packages/shared', 'packages/ui', 'scripts'],
    coverage: {
      provider: 'v8',
      // Count every source file, loaded by a test or not, so untested code shows as 0%
      // instead of silently not existing.
      include: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Starts the HTTP server (side effects at import); proven by the compose smoke test.
        'apps/api/src/index.ts',
        // Runs the one-shot development seed (process side effects at import); proven by compose smoke.
        'apps/api/src/seed-main.ts',
        // Async Server Component that reads cookies(); Vitest cannot render it. Its logic lives
        // in features/theme (tested); the page itself is proven by the smoke test.
        'apps/web/src/app/layout.tsx',
      ],
      reporter: ['text-summary', 'text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // A backstop against regressions, not a measure of test quality (see ADR 0012).
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
        // Domain contracts and the API carry the security-relevant logic: hold them higher.
        'packages/shared/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'apps/api/src/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
});
