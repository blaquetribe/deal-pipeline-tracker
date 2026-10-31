import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mountAuthRoutes: vi.fn<(...args: unknown[]) => void>(),
  mountDealRoutes: vi.fn<(...args: unknown[]) => void>(),
  mountNotificationRoutes: vi.fn<(...args: unknown[]) => void>(),
  mountRoleRoutes: vi.fn<(...args: unknown[]) => void>(),
  mountMemberRoutes: vi.fn<(...args: unknown[]) => void>(),
  createRateLimiter: vi.fn<() => unknown>(() => ({ hit: vi.fn<() => unknown>() })),
}));

vi.mock('./auth/service', () => ({ mountAuthRoutes: mocks.mountAuthRoutes }));
vi.mock('./features/deals/routes', () => ({ mountDealRoutes: mocks.mountDealRoutes }));
vi.mock('./features/notifications/routes', () => ({
  mountNotificationRoutes: mocks.mountNotificationRoutes,
}));
vi.mock('./features/roles/routes', () => ({ mountRoleRoutes: mocks.mountRoleRoutes }));
vi.mock('./features/members/routes', () => ({ mountMemberRoutes: mocks.mountMemberRoutes }));
vi.mock('./http/rate-limit', () => ({ createRateLimiter: mocks.createRateLimiter }));

import { createApp } from './app';
import type { AppOptions } from './app';

describe('api app', () => {
  const app = createApp();

  it('serves a data-free health response', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('locks down browser behaviour on API responses', async () => {
    const res = await app.request('/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await app.request('/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('mounts protected routes and supplies a default limiter when configured', () => {
    const auth: AppOptions['auth'] = {
      rpc: {
        call: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<unknown>>(
          async () => null,
        ),
      },
      userRpc: {
        call: vi.fn<(...args: [string, Record<string, unknown>, string]) => Promise<unknown>>(
          async () => null,
        ),
      },
      gotrue: {
        passwordLogin: vi.fn<(...args: [string, string]) => Promise<null>>(async () => null),
        refresh: vi.fn<(...args: [string]) => Promise<null>>(async () => null),
        logout: vi.fn<(...args: [string]) => Promise<void>>(async () => undefined),
        createUser: vi.fn<
          (...args: [{ email: string; password: string; fullName: string }]) => Promise<'exists'>
        >(async () => 'exists'),
        ensureDemoUser: async () => undefined,
        setPassword: vi.fn<(...args: [string, string]) => Promise<void>>(async () => undefined),
      },
      sessions: {
        create: vi.fn<() => Promise<{ sessionId: string }>>(async () => ({
          sessionId: 'A'.repeat(43),
        })),
        lookup: vi.fn<(...args: [string]) => Promise<null>>(async () => null),
        claimRefresh: vi.fn<() => Promise<null>>(async () => null),
        completeRefresh: vi.fn<() => Promise<boolean>>(async () => false),
        releaseRefresh: vi.fn<() => Promise<void>>(async () => undefined),
        setTenant: vi.fn<(...args: [string, string]) => Promise<boolean>>(async () => false),
        revoke: vi.fn<(...args: [string]) => Promise<void>>(async () => undefined),
        revokeUser: vi.fn<(...args: [string]) => Promise<number>>(async () => 0),
      },
      mailer: { send: vi.fn<(...args: [never]) => Promise<void>>(async () => undefined) },
      sessionSecret: 'test-session-secret-that-is-long-enough-123',
      appOrigin: 'http://localhost:8080',
    };
    const http: AppOptions['http'] = {
      appOrigin: 'http://localhost:8080',
      cookieSecure: false,
      resolver: { resolve: vi.fn<(...args: [string]) => Promise<null>>(async () => null) },
      logger: {
        info: vi.fn<(...args: [string, Record<string, unknown>?]) => void>(),
        error: vi.fn<(...args: [string, Record<string, unknown>?]) => void>(),
      },
    };
    const configuredApp = createApp({ auth, http });

    expect(mocks.createRateLimiter).toHaveBeenCalledOnce();
    expect(mocks.mountAuthRoutes).toHaveBeenCalledWith(
      configuredApp,
      { ...http, limiter: expect.any(Object) },
      auth,
    );
    expect(mocks.mountDealRoutes).toHaveBeenCalledWith(configuredApp, expect.any(Object), {
      userRpc: auth.userRpc,
    });
    expect(mocks.mountNotificationRoutes).toHaveBeenCalledWith(configuredApp, expect.any(Object), {
      userRpc: auth.userRpc,
    });
    expect(mocks.mountRoleRoutes).toHaveBeenCalledWith(configuredApp, expect.any(Object), {
      userRpc: auth.userRpc,
    });
    expect(mocks.mountMemberRoutes).toHaveBeenCalledWith(configuredApp, expect.any(Object), {
      userRpc: auth.userRpc,
    });
  });
});
