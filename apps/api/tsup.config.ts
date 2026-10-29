import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/seed-main.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle the API and workspace contract; deploy production dependencies separately so
  // native packages and their CommonJS runtime dependencies retain their native module format.
  noExternal: ['@dpt/shared'],
  external: ['ws', 'sharp'],
});
