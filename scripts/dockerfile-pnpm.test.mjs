import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const { packageManager } = JSON.parse(read('package.json'));

describe('Dockerfile pnpm version', () => {
  it.each(['apps/api/Dockerfile', 'apps/web/Dockerfile'])(
    '%s installs the pnpm version pinned in package.json',
    (file) => {
      const version = /^ARG PNPM_VERSION=(\S+)$/m.exec(read(file))?.[1];
      expect(`pnpm@${version}`).toBe(packageManager);
    },
  );
});
