import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/seed-main.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the API and workspace code, but keep native sharp and ws in production deps.
  noExternal: [/^(?!ws$).*/],
  external: ['ws', 'sharp'],
});
