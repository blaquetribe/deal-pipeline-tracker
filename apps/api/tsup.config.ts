import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle everything: workspace packages ship TypeScript source, and a single
  // self-contained file lets the runtime image carry no node_modules. Switch to
  // `pnpm deploy` when a native module (sharp) arrives, since those cannot be bundled.
  noExternal: [/.*/],
});
