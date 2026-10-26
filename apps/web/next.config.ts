import path from 'node:path';

import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@dpt/shared'],
  // Monorepo: trace files from the repo root so the standalone output is complete.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;
