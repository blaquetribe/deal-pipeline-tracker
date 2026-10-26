import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { entropy, findProblems } from './env-guard.mjs';

// Fake secrets are assembled at runtime so the secret scanner never sees a literal one.
const fakeSecret = ['k3Jx9Qm2', 'Lp7Zr4Wt', '8Vb1Nc6H', 'd5Gs0Fa1', 'Qe2Yu7Io'].join('');
const fakeHexId = ['9f3a', 'c1d8', '47be', '0a65', 'e2f9', '3b7c', '8d14', '5a60'].join('');
const name = (...parts) => parts.join('_');

describe('findProblems', () => {
  it('accepts placeholders, empty values, comments and plain settings', () => {
    const text = [
      '# comment',
      '',
      'GATEWAY_PORT=8080',
      `${name('API', 'KEY')}=`,
      `${name('DB', 'PASSWORD')}=your-password-here`,
      `${name('JWT', 'SECRET')}=dev-only-not-a-real-secret`,
      `${name('S3', 'SECRET', 'KEY')}=<set in .env>`,
      `${name('AUTH', 'TOKEN')}=changeme`,
      `${name('X', 'TOKEN')}="***"`,
    ].join('\n');
    expect(findProblems(text)).toEqual([]);
  });

  it('flags a sensitive name with a real-looking value, with its line number', () => {
    const text = [
      'GATEWAY_PORT=8080',
      `${name('STORAGE', 'SECRET', 'ACCESS', 'KEY')}="${fakeSecret}"`,
    ].join('\n');
    expect(findProblems(text)).toEqual([
      {
        line: 2,
        key: name('STORAGE', 'SECRET', 'ACCESS', 'KEY'),
        reason: 'sensitive name with a non-placeholder value',
      },
    ]);
  });

  it('flags a generated-looking value even under an innocent name', () => {
    const problems = findProblems(`${name('CF', 'ACCOUNT', 'ID')}="${fakeHexId}"`);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('generated');
  });

  it('flags private keys and JWTs', () => {
    expect(findProblems('PEM=-----BEGIN PRIVATE KEY-----')).toHaveLength(1);
    expect(findProblems(`BEARER=eyJhbGciOiJIUzI1NiJ9.${fakeSecret}.${fakeSecret}`)).toHaveLength(1);
  });

  it('does not flag ordinary non-secret values', () => {
    const text = [
      'PUBLIC_BASE_URL=http://localhost:8080',
      'NODE_ENV=development',
      'REGION=auto',
    ].join('\n');
    expect(findProblems(text)).toEqual([]);
  });

  it('never puts the value in its findings', () => {
    const found = JSON.stringify(findProblems(`${name('A', 'SECRET')}=${fakeSecret}`));
    expect(found).not.toContain(fakeSecret);
  });

  it('measures entropy', () => {
    expect(entropy('aaaaaaaa')).toBe(0);
    expect(entropy(fakeSecret)).toBeGreaterThan(3.5);
  });
});

describe('check-env-example CLI', () => {
  const script = fileURLToPath(new URL('./check-env-example.mjs', import.meta.url));
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-guard-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (file) => spawnSync(process.execPath, [script, file], { encoding: 'utf8' });

  it('exits 0 for a clean template and for a missing file', () => {
    writeFileSync(join(dir, 'ok'), 'GATEWAY_PORT=8080\n');
    expect(run(join(dir, 'ok')).status).toBe(0);
    expect(run(join(dir, 'does-not-exist')).status).toBe(0);
  });

  it('exits 1, names the variable and line, and never prints the secret', () => {
    const file = join(dir, 'leaky');
    writeFileSync(
      file,
      `GATEWAY_PORT=8080\n${name('R2', 'SECRET', 'ACCESS', 'KEY')}=${fakeSecret}\n`,
    );
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${file}:2: ${name('R2', 'SECRET', 'ACCESS', 'KEY')}`);
    expect(result.stderr).not.toContain(fakeSecret);
    expect(result.stdout).not.toContain(fakeSecret);
  });
});
