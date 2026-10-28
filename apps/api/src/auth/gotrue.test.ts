import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createGoTrue, GoTrueError } from './gotrue';

const JWT_SECRET = 'dev-only-jwt-secret-change-me-minimum-32-characters';
const NOW = 1_800_000_000_000;

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function harness(respond: (seen: Seen) => Response | Error) {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const entry: Seen = {
      url: urlOf(input),
      method: init?.method ?? 'GET',
      headers: z.record(z.string(), z.string()).parse(init?.headers ?? {}),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    seen.push(entry);
    const result = respond(entry);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  const gotrue = createGoTrue({
    baseUrl: 'http://gw:8000',
    anonKey: 'anon-key',
    jwtSecret: JWT_SECRET,
    fetchFn,
    now: () => NOW,
  });
  return { gotrue, seen };
}

const tokenBody = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  expires_at: 1_800_003_600,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.test',
    user_metadata: { full_name: 'Ada Lovelace' },
  },
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const err = (status: number, error_code: string) =>
  new Response(JSON.stringify({ error_code, msg: 'x' }), { status });

function claimsOf(authorization: string | undefined): Record<string, unknown> {
  const payload = (authorization ?? '').replace('Bearer ', '').split('.')[1] ?? '';
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
}

describe('passwordLogin', () => {
  it('signs in with the anon key and returns the sealed-to-be tokens and identity', async () => {
    const { gotrue, seen } = harness(() => ok(tokenBody));
    const result = await gotrue.passwordLogin('ada@example.test', 'correct-horse');
    expect(result).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      tokens: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 1_800_003_600_000,
        email: 'ada@example.test',
        fullName: 'Ada Lovelace',
      },
    });
    expect(seen[0]).toMatchObject({
      url: 'http://gw:8000/auth/v1/token?grant_type=password',
      method: 'POST',
      body: { email: 'ada@example.test', password: 'correct-horse' },
    });
    expect(seen[0]?.headers['apikey']).toBe('anon-key');
    expect(seen[0]?.headers['Authorization']).toBeUndefined();
  });

  it('computes expiry from expires_in when expires_at is absent and tolerates missing metadata', async () => {
    const { gotrue } = harness(() =>
      ok({
        ...tokenBody,
        expires_at: undefined,
        user: { id: tokenBody.user.id, email: 'ada@example.test' },
      }),
    );
    const result = await gotrue.passwordLogin('ada@example.test', 'x');
    expect(result?.tokens.expiresAt).toBe(NOW + 3_600_000);
    expect(result?.tokens.fullName).toBeNull();
  });

  it.each(['invalid_credentials', 'email_not_confirmed'])(
    'treats %s as a failed sign-in, without saying which',
    async (code) => {
      const { gotrue } = harness(() => err(400, code));
      await expect(gotrue.passwordLogin('a@b.co', 'x')).resolves.toBeNull();
    },
  );

  it('reports an outage, not a failed sign-in, for 5xx, network errors and unreadable answers', async () => {
    await expect(
      harness(() => err(500, 'unexpected_failure')).gotrue.passwordLogin('a@b.co', 'x'),
    ).rejects.toBeInstanceOf(GoTrueError);
    await expect(
      harness(() => new Error('connect ECONNREFUSED')).gotrue.passwordLogin('a@b.co', 'x'),
    ).rejects.toBeInstanceOf(GoTrueError);
    await expect(
      harness(() => ok({ nonsense: true })).gotrue.passwordLogin('a@b.co', 'x'),
    ).rejects.toBeInstanceOf(GoTrueError);
  });
});

describe('refresh and logout', () => {
  it('exchanges a refresh token', async () => {
    const { gotrue, seen } = harness(() =>
      ok({ ...tokenBody, access_token: 'access-2', refresh_token: 'refresh-2' }),
    );
    const result = await gotrue.refresh('refresh-1');
    expect(result?.tokens.accessToken).toBe('access-2');
    expect(seen[0]).toMatchObject({
      url: 'http://gw:8000/auth/v1/token?grant_type=refresh_token',
      body: { refresh_token: 'refresh-1' },
    });
  });

  it.each(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'])(
    'returns null for %s',
    async (code) => {
      await expect(harness(() => err(400, code)).gotrue.refresh('r')).resolves.toBeNull();
      await expect(harness(() => err(401, code)).gotrue.refresh('r')).resolves.toBeNull();
    },
  );

  it('logs out with the user token and ignores a failure (the session is revoked locally anyway)', async () => {
    const { gotrue, seen } = harness(() => new Response(null, { status: 204 }));
    await gotrue.logout('user-access');
    expect(seen[0]).toMatchObject({ url: 'http://gw:8000/auth/v1/logout', method: 'POST' });
    expect(seen[0]?.headers['Authorization']).toBe('Bearer user-access');
    await expect(harness(() => new Error('down')).gotrue.logout('x')).resolves.toBeUndefined();
  });
});

describe('admin operations (ADR 0016)', () => {
  it('creates an unconfirmed user with a 30 second service_role token', async () => {
    const { gotrue, seen } = harness(() =>
      ok({ id: '22222222-2222-4222-8222-222222222222', email: 'new@example.test' }),
    );
    await expect(
      gotrue.createUser({
        email: 'new@example.test',
        password: 'correct-horse',
        fullName: 'New User',
      }),
    ).resolves.toEqual({
      userId: '22222222-2222-4222-8222-222222222222',
    });
    expect(seen[0]).toMatchObject({
      url: 'http://gw:8000/auth/v1/admin/users',
      method: 'POST',
      body: {
        email: 'new@example.test',
        password: 'correct-horse',
        email_confirm: false,
        user_metadata: { full_name: 'New User' },
      },
    });
    expect(seen[0]?.headers['apikey']).toBe('anon-key');
    const claims = claimsOf(seen[0]?.headers['Authorization']);
    expect(claims).toMatchObject({ role: 'service_role', iat: 1_800_000_000, exp: 1_800_000_030 });
  });

  it('answers "exists" for a registered email, whatever GoTrue calls it', async () => {
    await expect(
      harness(() => err(422, 'email_exists')).gotrue.createUser({
        email: 'a@b.co',
        password: 'p',
        fullName: 'n',
      }),
    ).resolves.toBe('exists');
    await expect(
      harness(() => err(422, 'user_already_exists')).gotrue.createUser({
        email: 'a@b.co',
        password: 'p',
        fullName: 'n',
      }),
    ).resolves.toBe('exists');
  });

  it('turns a weak-password rejection into a validation error and other failures into an outage', async () => {
    const weak = harness(() => err(422, 'weak_password')).gotrue.createUser({
      email: 'a@b.co',
      password: 'p',
      fullName: 'n',
    });
    await expect(weak).rejects.toMatchObject({ kind: 'weak_password' });
    const down = harness(() => err(500, 'unexpected_failure')).gotrue.createUser({
      email: 'a@b.co',
      password: 'p',
      fullName: 'n',
    });
    await expect(down).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('sets a password for a user id, with the same short-lived token', async () => {
    const { gotrue, seen } = harness(() => ok({ id: 'x' }));
    await gotrue.setPassword('22222222-2222-4222-8222-222222222222', 'new-correct-horse');
    expect(seen[0]).toMatchObject({
      url: 'http://gw:8000/auth/v1/admin/users/22222222-2222-4222-8222-222222222222',
      method: 'PUT',
      body: { password: 'new-correct-horse' },
    });
    expect(claimsOf(seen[0]?.headers['Authorization'])).toMatchObject({
      role: 'service_role',
      exp: 1_800_000_030,
    });
  });

  it('refuses a user id that is not a UUID before it reaches the URL', async () => {
    const { gotrue, seen } = harness(() => ok({}));
    await expect(gotrue.setPassword('../../admin/users', 'x')).rejects.toBeInstanceOf(GoTrueError);
    expect(seen).toHaveLength(0);
  });

  it('fails when a password change is not accepted', async () => {
    await expect(
      harness(() => err(404, 'user_not_found')).gotrue.setPassword(
        '22222222-2222-4222-8222-222222222222',
        'x',
      ),
    ).rejects.toBeInstanceOf(GoTrueError);
  });
});
