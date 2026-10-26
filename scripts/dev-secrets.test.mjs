import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GENERATED, mergeEnv } from './gen-dev-env.mjs';
import { signSupabaseKey } from './supabase-keys.mjs';

// The gateway entrypoint derives keys with openssl; Envoy compares them by string equality.
// This is the same algorithm, copied from supabase/gateway/docker-entrypoint.sh.
const shell = (role, secret) =>
  spawnSync(
    'sh',
    [
      '-c',
      `b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
       header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
       payload=$(printf '{"role":"%s","iss":"supabase","iat":1700000000,"exp":4102444800}' "$1" | b64url)
       signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
       printf '%s.%s.%s' "$header" "$payload" "$signature"`,
      'sh',
      role,
      secret,
    ],
    { encoding: 'utf8' },
  ).stdout;

describe('signSupabaseKey', () => {
  it.each(['anon', 'service_role'])('matches the gateway shell implementation for %s', (role) => {
    const secret = 'unit-test-secret-that-is-at-least-32-characters-long';
    expect(signSupabaseKey(role, secret)).toBe(shell(role, secret));
  });

  it('is deterministic and depends on the secret', () => {
    const a = signSupabaseKey('anon', 'unit-test-secret-one-at-least-32-characters!!');
    expect(a).toBe(signSupabaseKey('anon', 'unit-test-secret-one-at-least-32-characters!!'));
    expect(a).not.toBe(signSupabaseKey('anon', 'unit-test-secret-two-at-least-32-characters!!'));
    expect(a).not.toBe(
      signSupabaseKey('service_role', 'unit-test-secret-one-at-least-32-characters!!'),
    );
  });

  it('carries the role and fixed claims', () => {
    const payload = JSON.parse(
      Buffer.from(
        signSupabaseKey('service_role', 'x'.repeat(40)).split('.')[1],
        'base64url',
      ).toString(),
    );
    expect(payload).toEqual({
      role: 'service_role',
      iss: 'supabase',
      iat: 1700000000,
      exp: 4102444800,
    });
  });
});

describe('mergeEnv', () => {
  it('adds every missing key to an empty file', () => {
    const { text, added } = mergeEnv('');
    expect(added).toEqual(Object.keys(GENERATED));
    for (const key of added) {
      expect(text).toMatch(new RegExp(`^${key}=.+$`, 'm'));
    }
  });

  it('never changes an existing value and keeps unrelated lines', () => {
    const existing =
      'GATEWAY_PORT=9090\nJWT_SECRET=keep-me\nSTORAGE_BUCKET=deal-pipeline-tracker\n';
    const { text, added } = mergeEnv(existing);
    expect(text.startsWith(existing)).toBe(true);
    expect(added).not.toContain('JWT_SECRET');
    expect(text).toContain('JWT_SECRET=keep-me\n');
    expect(text.match(/^JWT_SECRET=/gm)).toHaveLength(1);
  });

  it('is idempotent', () => {
    const first = mergeEnv('GATEWAY_PORT=8080');
    const second = mergeEnv(first.text);
    expect(second.added).toEqual([]);
    expect(second.text).toBe(first.text);
  });

  it('generates secrets that satisfy the services constraints', () => {
    const values = Object.fromEntries(Object.entries(GENERATED).map(([k, make]) => [k, make()]));
    expect(values.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(values.SECRET_KEY_BASE.length).toBeGreaterThanOrEqual(64);
    expect(values.REALTIME_DB_ENC_KEY).toHaveLength(16);
    expect(values.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(GENERATED.JWT_SECRET()).not.toBe(GENERATED.JWT_SECRET());
  });
});

describe('gen-dev-env CLI', () => {
  const script = fileURLToPath(new URL('./gen-dev-env.mjs', import.meta.url));
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gen-env-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a mode-600 file and prints key names, never values', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'GATEWAY_PORT=8080\n');
    const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POSTGRES_PASSWORD');
    const written = readFileSync(file, 'utf8');
    const jwtSecret = /^JWT_SECRET=(.+)$/m.exec(written)?.[1] ?? '';
    expect(jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(result.stdout).not.toContain(jwtSecret);
    expect(result.stderr).not.toContain(jwtSecret);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(written.startsWith('GATEWAY_PORT=8080\n')).toBe(true);
  });

  it('does nothing the second time', () => {
    const file = join(dir, '.env');
    spawnSync(process.execPath, [script, file]);
    const before = readFileSync(file, 'utf8');
    const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    expect(result.stdout).toContain('nothing to add');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
