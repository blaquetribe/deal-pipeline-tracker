import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the output.
  noExternal: [/^@dpt\//],
});
