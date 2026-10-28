import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { createRateLimiter } from '../../http/rate-limit';
import type { Session, SessionResolver } from '../../http/route';
import { mountRealtimeRoutes } from './routes';

const feedState = vi.hoisted(() => ({
  onNotification: null as ((row: unknown) => void) | null,
  onSubscribed: null as (() => void) | null,
  onUnavailable: null as ((status: string) => void) | null,
  closed: false,
  closeWaiter: null as (() => void) | null,
  updatedTokens: [] as string[],
  initError: false,
  holdInit: false,
  releaseInit: [] as Array<() => void>,
}));

vi.mock('../../db/realtime', () => ({
  createRealtimeFeed: async (options: {
    onNotification: (row: unknown) => void;
    onSubscribed: () => void;
    onUnavailable: (status: string) => void;
  }) => {
    if (feedState.initError) throw new Error('private upstream error');
    if (feedState.holdInit) {
      await new Promise<void>((resolve) => {
        feedState.releaseInit.push(resolve);
      });
    }
    feedState.onNotification = options.onNotification;
    feedState.onSubscribed = options.onSubscribed;
    feedState.onUnavailable = options.onUnavailable;
    return {
      updateAccessToken: vi.fn<(token: string) => void>((token) => {
        feedState.updatedTokens.push(token);
      }),
      close: () => {
        feedState.closed = true;
        feedState.closeWaiter?.();
      },
    };
  },
}));

const SESSION_ID = 'A'.repeat(43);
const TENANT = 'cccccccc-0000-4000-8000-000000000001';

function publishNotification(row: unknown): void {
  const callback = feedState.onNotification;
  if (callback) callback(row);
}

function publishSubscribed(): void {
  feedState.onSubscribed?.();
}

function publishUnavailable(): void {
  feedState.onUnavailable?.('CHANNEL_ERROR');
}

function harness(
  overrides: {
    resolver?: SessionResolver;
    appOrigin?: string;
    limiter?: ReturnType<typeof createRateLimiter>;
    sessionCheckMs?: number;
  } = {},
) {
  const resolver: SessionResolver = overrides.resolver ?? {
    resolve: vi.fn<(sessionId: string) => Promise<Session>>(async (sessionId) => ({
      sessionId,
      userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenantId: TENANT,
      accessToken: 'caller-jwt',
      csrfToken: 'csrf-token',
    })),
  };
  const app = new Hono();
  const deps = {
    appOrigin: overrides.appOrigin ?? 'http://localhost:8080',
    cookieSecure: false,
    resolver,
    limiter: overrides.limiter ?? createRateLimiter(),
    logger: { info: vi.fn<() => void>(), error: vi.fn<() => void>() },
  };
  const routes = mountRealtimeRoutes(app, deps, {
    supabaseUrl: 'http://supabase-gateway:8000',
    anonKey: 'public-anon-key',
    http: deps,
    ...(overrides.sessionCheckMs ? { sessionCheckMs: overrides.sessionCheckMs } : {}),
  });
  return { app, deps, routes, resolver };
}

describe('realtime websocket route', () => {
  it('declares a session-gated same-origin websocket endpoint', () => {
    const { routes } = harness();
    expect(routes.map(({ method, path, access }) => ({ method, path, access }))).toEqual([
      { method: 'GET', path: '/ws', access: 'session' },
    ]);
  });

  it('rejects a missing or foreign Origin before looking up the session', async () => {
    const resolve = vi.fn<(sessionId: string) => Promise<Session>>(async (sessionId) => ({
      sessionId,
      userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenantId: TENANT,
      accessToken: 'caller-jwt',
      csrfToken: 'csrf-token',
    }));
    const { app } = harness({ resolver: { resolve } });
    const missing = await app.request('/ws', { headers: { Cookie: `dpt_session=${SESSION_ID}` } });
    const foreign = await app.request('/ws', {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'https://attacker.example' },
    });
    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('requires the opaque session and an active tenant', async () => {
    const resolve = vi.fn<() => Promise<Session | null>>(async () => null);
    const { app } = harness({
      resolver: { resolve },
    });
    const response = await app.request('/ws', { headers: { Origin: 'http://localhost:8080' } });
    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('fails closed when session storage is unavailable', async () => {
    const resolve = vi.fn<() => Promise<Session | null>>(async () => {
      throw new Error('private database error');
    });
    const { app } = harness({ resolver: { resolve } });
    const response = await app.request('/ws', {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database error');
  });

  it('rate limits websocket handshakes by gateway peer address', async () => {
    const limiter = {
      hit: vi.fn<ReturnType<typeof createRateLimiter>['hit']>(() => ({
        allowed: false,
        retryAfterSeconds: 30,
      })),
      size: () => 0,
    };
    const resolve = vi.fn<(sessionId: string) => Promise<Session>>(async (sessionId) => ({
      sessionId,
      userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenantId: TENANT,
      accessToken: 'caller-jwt',
      csrfToken: 'csrf-token',
    }));
    const { app } = harness({ limiter, resolver: { resolve } });
    const response = await app.request('/ws', {
      headers: {
        Cookie: `dpt_session=${SESSION_ID}`,
        Origin: 'http://localhost:8080',
        'X-Forwarded-For': '192.0.2.3',
      },
    });
    expect(response.status).toBe(429);
    expect(limiter.hit).toHaveBeenCalledWith('websocket:192.0.2.3', {
      limit: 30,
      windowSeconds: 60,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('relays a notification to an authenticated real websocket and closes the feed on disconnect', async () => {
    feedState.onNotification = null;
    feedState.onUnavailable = null;
    feedState.closed = false;
    feedState.closeWaiter = null;
    feedState.updatedTokens = [];
    let activeSession: Session | null = {
      sessionId: SESSION_ID,
      userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenantId: TENANT,
      accessToken: 'caller-jwt',
      csrfToken: 'csrf-token',
    };
    const resolve = vi.fn<(sessionId: string) => Promise<Session | null>>(
      async () => activeSession,
    );
    const { app } = harness({ resolver: { resolve }, sessionCheckMs: 10 });
    const websocketServer = new WebSocketServer({ noServer: true });
    type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];
    // ws and Hono differ only in callback overload types; Hono uses the documented ws noServer API.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const adapter = websocketServer as unknown as WebSocketAdapter;
    let port = 0;
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: adapter } },
      (info) => {
        port = info.port;
      },
    );
    await new Promise<void>((done) => server.once('listening', done));
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    await once(client, 'open');
    expect(feedState.onNotification).toBeTypeOf('function');
    const ready = once(client, 'message');
    publishSubscribed();
    const [readyData] = await ready;
    expect(JSON.parse(String(readyData))).toEqual({ type: 'status', status: 'connected' });
    if (!activeSession) throw new Error('test session should remain active');
    activeSession = { ...activeSession, accessToken: 'rotated-jwt' };
    await vi.waitFor(() => expect(feedState.updatedTokens).toContain('rotated-jwt'));
    const message = once(client, 'message');
    publishNotification({
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      tenant_id: TENANT,
      user_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'closing_soon',
      payload: { dealName: 'Example deal' },
      created_at: '2026-10-28T10:00:00Z',
      read_at: null,
    });
    const [data] = await message;
    expect(JSON.parse(String(data))).toEqual({
      type: 'notification',
      data: {
        id: 'bbbbbbbb-0000-4000-8000-000000000001',
        tenant_id: TENANT,
        user_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        kind: 'closing_soon',
        payload: { dealName: 'Example deal' },
        created_at: '2026-10-28T10:00:00Z',
        read_at: null,
      },
    });
    activeSession = null;
    const closed = once(client, 'close');
    const feedClosed = new Promise<void>((done) => {
      feedState.closeWaiter = done;
    });
    const [closeCode] = await closed;
    expect(closeCode).toBe(4001);
    await feedClosed;
    expect(feedState.closed).toBe(true);
    await new Promise<void>((done) => server.close(() => done()));
    expect(resolve).toHaveBeenCalledWith(SESSION_ID);
  });

  it('closes the websocket when the upstream Realtime feed fails', async () => {
    feedState.onNotification = null;
    feedState.onUnavailable = null;
    feedState.closed = false;
    const { app } = harness();
    const websocketServer = new WebSocketServer({ noServer: true });
    type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const adapter = websocketServer as unknown as WebSocketAdapter;
    let port = 0;
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: adapter } },
      (info) => {
        port = info.port;
      },
    );
    await new Promise<void>((done) => server.once('listening', done));
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    await once(client, 'open');
    const closed = once(client, 'close');
    publishUnavailable();
    const [closeCode] = await closed;
    expect(closeCode).toBe(1011);
    await vi.waitFor(() => expect(feedState.closed).toBe(true));
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('closes the websocket when Realtime client initialization fails', async () => {
    feedState.initError = true;
    const { app } = harness();
    const websocketServer = new WebSocketServer({ noServer: true });
    type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const adapter = websocketServer as unknown as WebSocketAdapter;
    let port = 0;
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: adapter } },
      (info) => {
        port = info.port;
      },
    );
    await new Promise<void>((done) => server.once('listening', done));
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    await once(client, 'open');
    const closed = once(client, 'close');
    const [closeCode] = await closed;
    expect(closeCode).toBe(1011);
    await new Promise<void>((done) => server.close(() => done()));
    feedState.initError = false;
  });

  it('applies a rotated token after asynchronous Realtime initialization', async () => {
    feedState.holdInit = true;
    feedState.releaseInit = [];
    let activeSession: Session = {
      sessionId: SESSION_ID,
      userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenantId: TENANT,
      accessToken: 'caller-jwt',
      csrfToken: 'csrf-token',
    };
    let resolveRotation: (() => void) | undefined;
    const rotationChecked = new Promise<void>((done) => {
      resolveRotation = done;
    });
    const resolve = vi.fn<(sessionId: string) => Promise<Session>>(async () => {
      if (activeSession.accessToken === 'rotated-jwt') resolveRotation?.();
      return activeSession;
    });
    const { app } = harness({ resolver: { resolve }, sessionCheckMs: 10 });
    const websocketServer = new WebSocketServer({ noServer: true });
    type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const adapter = websocketServer as unknown as WebSocketAdapter;
    let port = 0;
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: adapter } },
      (info) => {
        port = info.port;
      },
    );
    await new Promise<void>((done) => server.once('listening', done));
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    await once(client, 'open');
    await vi.waitFor(() => expect(feedState.releaseInit.length).toBeGreaterThan(0));
    activeSession = { ...activeSession, accessToken: 'rotated-jwt' };
    await rotationChecked;
    feedState.releaseInit[0]?.();
    await vi.waitFor(() => expect(feedState.updatedTokens).toContain('rotated-jwt'));
    const closed = once(client, 'close');
    client.close();
    await closed;
    await new Promise<void>((done) => server.close(() => done()));
    feedState.holdInit = false;
  });

  it('closes a late feed if its websocket disconnected during initialization', async () => {
    feedState.holdInit = true;
    feedState.releaseInit = [];
    feedState.closed = false;
    const { app } = harness();
    const websocketServer = new WebSocketServer({ noServer: true });
    type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const adapter = websocketServer as unknown as WebSocketAdapter;
    let port = 0;
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: adapter } },
      (info) => {
        port = info.port;
      },
    );
    await new Promise<void>((done) => server.once('listening', done));
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    await once(client, 'open');
    await vi.waitFor(() => expect(feedState.releaseInit.length).toBeGreaterThan(0));
    const closed = once(client, 'close');
    client.close();
    await closed;
    feedState.releaseInit[0]?.();
    await vi.waitFor(() => expect(feedState.closed).toBe(true));
    await new Promise<void>((done) => server.close(() => done()));
    feedState.holdInit = false;
  });

  it('closes the websocket if session revalidation throws', async () => {
    let calls = 0;
    const resolve = vi.fn<(sessionId: string) => Promise<Session>>(async () => {
      calls += 1;
      if (calls > 1) throw new Error('private session error');
      return {
        sessionId: SESSION_ID,
        userId: 'aaaaaaaa-0000-4000-8000-000000000001',
        tenantId: TENANT,
        accessToken: 'caller-jwt',
        csrfToken: 'csrf-token',
      };
    });
    const { app } = harness({ resolver: { resolve }, sessionCheckMs: 10 });
    const websocketServer = new WebSocketServer({ noServer: true });
    type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const adapter = websocketServer as unknown as WebSocketAdapter;
    let port = 0;
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: adapter } },
      (info) => {
        port = info.port;
      },
    );
    await new Promise<void>((done) => server.once('listening', done));
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `dpt_session=${SESSION_ID}`, Origin: 'http://localhost:8080' },
    });
    await once(client, 'open');
    const closed = once(client, 'close');
    const [closeCode] = await closed;
    expect(closeCode).toBe(4001);
    await new Promise<void>((done) => server.close(() => done()));
  });
});
