import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { RpcError } from '../db/rpc';
import { createRateLimiter } from './rate-limit';
import {
  cookieName,
  describeRoutes,
  noBody,
  publicRoute,
  sessionRoute,
  type HttpDeps,
  type Logger,
  type Route,
  type Session,
} from './route';

const ORIGIN = 'http://localhost:8080';
const session: Session = {
  sessionId: 'sid',
  userId: 'user-1',
  tenantId: 'tenant-1',
  csrfToken: 'csrf-ok',
};

function build(routes: readonly Route[], overrides: Partial<HttpDeps> = {}) {
  const logger = { info: vi.fn<Logger['info']>(), error: vi.fn<Logger['error']>() };
  const deps: HttpDeps = {
    appOrigin: ORIGIN,
    cookieSecure: false,
    resolver: { resolve: (id) => Promise.resolve(id === 'good-session' ? session : null) },
    limiter: createRateLimiter(() => 0),
    logger,
    ...overrides,
  };
  const app = new Hono();
  for (const route of routes) {
    route.mount(app, deps);
  }
  return { app, logger };
}

const envelopeSchema = z.looseObject({
  error: z
    .looseObject({ code: z.string().optional(), fields: z.array(z.string()).optional() })
    .optional(),
});
const errorOf = async (res: Response) => envelopeSchema.parse(await res.json()).error;

const cookie = (value: string, secure = false) => ({ Cookie: `${cookieName(secure)}=${value}` });

const failing = (error: unknown) =>
  publicRoute({ method: 'GET', path: '/fail', body: noBody, handler: () => Promise.reject(error) });

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
  body: JSON.stringify(body),
});

const echo = publicRoute({
  method: 'POST',
  path: '/echo',
  body: z.strictObject({ name: z.string().min(1) }),
  handler: (ctx) => Promise.resolve({ body: { hello: ctx.body.name } }),
});

describe('public routes', () => {
  it('answers a GET with no origin or session', async () => {
    const { app } = build([
      publicRoute({
        method: 'GET',
        path: '/ping',
        body: noBody,
        handler: () => Promise.resolve({ body: { ok: true } }),
      }),
    ]);
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a supplied request id', async () => {
    const { app } = build([
      publicRoute({
        method: 'GET',
        path: '/ping',
        body: noBody,
        handler: () => Promise.resolve({ body: {} }),
      }),
    ]);
    const res = await app.request('/ping', { headers: { 'X-Request-Id': 'abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('abc-123');
  });

  it('refuses an unsafe request without a matching Origin (cross-site forgery)', async () => {
    const { app } = build([echo]);
    const noOrigin = await app.request('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"a"}',
    });
    expect(noOrigin.status).toBe(403);
    expect((await errorOf(noOrigin))?.code).toBe('bad_origin');
    const wrong = await app.request(
      '/echo',
      json({ name: 'a' }, { Origin: 'https://evil.example' }),
    );
    expect(wrong.status).toBe(403);
  });

  it('accepts a matching Referer when Origin is absent, and refuses a malformed one', async () => {
    const { app } = build([echo]);
    const headers = { 'Content-Type': 'application/json' };
    const ok = await app.request('/echo', {
      method: 'POST',
      headers: { ...headers, Referer: `${ORIGIN}/login` },
      body: '{"name":"a"}',
    });
    expect(ok.status).toBe(200);
    const bad = await app.request('/echo', {
      method: 'POST',
      headers: { ...headers, Referer: 'not a url' },
      body: '{"name":"a"}',
    });
    expect(bad.status).toBe(403);
  });

  it('requires a JSON content type', async () => {
    const { app } = build([echo]);
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: ORIGIN },
      body: '{"name":"a"}',
    });
    expect(res.status).toBe(415);
  });

  it('validates the body, rejects unknown fields, and names the fields without echoing values', async () => {
    const { app } = build([echo]);
    const unknown = await app.request('/echo', json({ name: 'a', role: 'owner' }));
    expect(unknown.status).toBe(400);
    const empty = await app.request('/echo', json({ name: '' }));
    expect(await empty.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Check the highlighted fields.',
        fields: ['name'],
      },
    });
    const garbage = await app.request('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: '{nope',
    });
    expect(garbage.status).toBe(400);
    expect((await errorOf(garbage))?.fields).toEqual(['(body)']);
  });

  it('passes the validated body to the handler', async () => {
    const { app } = build([echo]);
    const res = await app.request('/echo', json({ name: 'Ada' }));
    expect(await res.json()).toEqual({ hello: 'Ada' });
  });

  it('refuses a body over 64 KiB', async () => {
    const { app } = build([echo]);
    const res = await app.request('/echo', json({ name: 'x'.repeat(70_000) }));
    expect(res.status).toBe(413);
  });

  it('rate limits per key with Retry-After', async () => {
    const limited = publicRoute({
      method: 'POST',
      path: '/limited',
      body: z.strictObject({ email: z.string() }),
      rateLimit: {
        name: 'limited',
        limit: 2,
        windowSeconds: 60,
        keys: ({ clientIp, body }) => [`ip:${clientIp}`, `acct:${body.email}`],
      },
      handler: () => Promise.resolve({ body: {} }),
    });
    const { app } = build([limited]);
    const call = (email: string, ip: string) =>
      app.request('/limited', json({ email }, { 'X-Forwarded-For': ip }));

    expect((await call('a@x.co', '1.1.1.1')).status).toBe(200);
    expect((await call('a@x.co', '2.2.2.2')).status).toBe(200);
    const blockedByAccount = await call('a@x.co', '3.3.3.3');
    expect(blockedByAccount.status).toBe(429);
    expect(blockedByAccount.headers.get('retry-after')).toBe('60');
    expect((await errorOf(blockedByAccount))?.code).toBe('rate_limited');
    // A different account from a fresh address is unaffected.
    expect((await call('b@x.co', '4.4.4.4')).status).toBe(200);
    // The same address is blocked after two requests whatever the account.
    expect((await call('c@x.co', '1.1.1.1')).status).toBe(200);
    expect((await call('d@x.co', '1.1.1.1')).status).toBe(429);
  });

  it('maps database errors, and hides everything else behind a generic 500 that is logged', async () => {
    const token = build([failing(new RpcError('DP401', 'invalid token', 400))]);
    const tokenRes = await token.app.request('/fail');
    expect(tokenRes.status).toBe(400);
    expect((await errorOf(tokenRes))?.code).toBe('invalid_token');
    expect(token.logger.error).not.toHaveBeenCalled();

    const boom = build([failing(new Error('password=hunter2 at postgres://db'))]);
    const boomRes = await boom.app.request('/fail');
    const text = await boomRes.text();
    expect(boomRes.status).toBe(500);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('postgres');
    expect(boom.logger.error).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ path: '/fail', error: 'Error' }),
    );
    expect(JSON.stringify(boom.logger.error.mock.calls)).not.toContain('hunter2');
  });

  it('sets and clears the session cookie with the right flags', async () => {
    const login = publicRoute({
      method: 'POST',
      path: '/in',
      body: noBody,
      handler: (ctx) => {
        ctx.setSessionCookie('opaque-id');
        return Promise.resolve({ status: 204 });
      },
    });
    const logout = publicRoute({
      method: 'POST',
      path: '/out',
      body: noBody,
      handler: (ctx) => {
        ctx.clearSessionCookie();
        return Promise.resolve({ status: 204 });
      },
    });
    const plain = build([login, logout]);
    const set =
      (await plain.app.request('/in', { method: 'POST', headers: { Origin: ORIGIN } })).headers.get(
        'set-cookie',
      ) ?? '';
    expect(set).toContain('dpt_session=opaque-id');
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toContain('Path=/');
    expect(set).toContain('Max-Age=43200');
    expect(set).not.toMatch(/Secure/i);

    const secure = build([login, logout], { cookieSecure: true });
    const secureSet =
      (
        await secure.app.request('/in', { method: 'POST', headers: { Origin: ORIGIN } })
      ).headers.get('set-cookie') ?? '';
    expect(secureSet).toContain('__Host-dpt_session=opaque-id');
    expect(secureSet).toMatch(/Secure/i);
    const cleared =
      (
        await secure.app.request('/out', { method: 'POST', headers: { Origin: ORIGIN } })
      ).headers.get('set-cookie') ?? '';
    expect(cleared).toContain('__Host-dpt_session=;');
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});

describe('session routes', () => {
  const secured = sessionRoute({
    method: 'POST',
    path: '/secured',
    permission: 'deal.create',
    body: z.strictObject({ n: z.number() }),
    handler: (ctx) =>
      Promise.resolve({
        status: 201,
        body: { user: ctx.session.userId, tenant: ctx.session.tenantId, n: ctx.body.n },
      }),
  });
  const read = sessionRoute({
    method: 'GET',
    path: '/me',
    body: noBody,
    handler: (ctx) => Promise.resolve({ body: { id: ctx.session.userId } }),
  });

  it('answers 401 with no cookie, and with a cookie the store does not know', async () => {
    const { app } = build([read, secured]);
    expect((await app.request('/me')).status).toBe(401);
    expect((await app.request('/me', { headers: cookie('stale') })).status).toBe(401);
    const res = await app.request('/secured', json({ n: 1 }, cookie('stale')));
    expect(res.status).toBe(401);
    expect((await errorOf(res))?.code).toBe('unauthenticated');
  });

  it('serves a GET to a valid session without a CSRF token', async () => {
    const { app } = build([read]);
    const res = await app.request('/me', { headers: cookie('good-session') });
    expect(await res.json()).toEqual({ id: 'user-1' });
  });

  it('requires the CSRF token on unsafe requests', async () => {
    const { app } = build([secured]);
    const missing = await app.request('/secured', json({ n: 1 }, cookie('good-session')));
    expect(missing.status).toBe(403);
    expect((await errorOf(missing))?.code).toBe('bad_csrf');
    const wrong = await app.request(
      '/secured',
      json({ n: 1 }, { ...cookie('good-session'), 'X-CSRF-Token': 'csrf-nope' }),
    );
    expect(wrong.status).toBe(403);
    const ok = await app.request(
      '/secured',
      json({ n: 1 }, { ...cookie('good-session'), 'X-CSRF-Token': 'csrf-ok' }),
    );
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ user: 'user-1', tenant: 'tenant-1', n: 1 });
  });

  it('checks the Origin before it looks at the session', async () => {
    const { app } = build([secured]);
    const res = await app.request(
      '/secured',
      json(
        { n: 1 },
        { ...cookie('good-session'), 'X-CSRF-Token': 'csrf-ok', Origin: 'https://evil.example' },
      ),
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res))?.code).toBe('bad_origin');
  });

  it('reads the __Host- cookie when cookies are Secure', async () => {
    const { app } = build([read], { cookieSecure: true });
    expect((await app.request('/me', { headers: cookie('good-session', true) })).status).toBe(200);
    expect((await app.request('/me', { headers: cookie('good-session', false) })).status).toBe(401);
  });

  it('returns 204 with no body', async () => {
    const gone = sessionRoute({
      method: 'DELETE',
      path: '/thing',
      body: noBody,
      handler: () => Promise.resolve({ status: 204 }),
    });
    const { app } = build([gone]);
    const res = await app.request('/thing', {
      method: 'DELETE',
      headers: { ...cookie('good-session'), Origin: ORIGIN, 'X-CSRF-Token': 'csrf-ok' },
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });
});

describe('describeRoutes', () => {
  it('lists every route with its access, for the signed-out sweep', () => {
    expect(
      describeRoutes([
        echo,
        sessionRoute({
          method: 'GET',
          path: '/me',
          body: noBody,
          handler: () => Promise.resolve({}),
        }),
      ]),
    ).toEqual([
      { method: 'POST', path: '/echo', access: 'public' },
      { method: 'GET', path: '/me', access: 'session' },
    ]);
  });
});
