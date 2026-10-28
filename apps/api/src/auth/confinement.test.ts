import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as gotrue from './gotrue';

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('ADR 0016: the admin role is confined to the GoTrue adapter', () => {
  it('mentions the service_role claim in no other source file', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('service_role'))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual(['auth/gotrue.ts']);
  });

  it('exports no way to mint the admin token', () => {
    expect(Object.keys(gotrue).toSorted()).toEqual(['GoTrueError', 'createGoTrue']);
  });

  it('imports Supabase packages only under auth/ and db/ (the lint boundary, checked here too)', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /from ['"]@supabase\//.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .filter((file) => !file.startsWith('auth/') && !file.startsWith('db/'));
    expect(offenders).toEqual([]);
  });
});
