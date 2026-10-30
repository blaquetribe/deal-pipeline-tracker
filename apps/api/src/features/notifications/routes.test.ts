import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../http/rate-limit';
import { describeRoutes, type Session, type SessionResolver } from '../../http/route';
import { mountNotificationRoutes } from './routes';

const TENANT = 'cccccccc-0000-4000-8000-000000000001';
const ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const COOKIE = `dpt_session=${'A'.repeat(43)}`;
const notification = {
  id: ID,
  kind: 'closing_soon',
  payload: {
    dealId: 'bbbbbbbb-0000-4000-8000-000000000002',
    dealName: 'Example deal',
    stage: 'sourcing',
    amount: '1000',
    currency: 'ZAR',
    closeDate: '2026-11-01',
    closeTime: null,
    timeZone: 'Africa/Johannesburg',
    thresholdDays: 5,
    href: '/deals/bbbbbbbb-0000-4000-8000-000000000002',
  },
  created_at: '2026-10-28T10:00:00Z',
  read_at: null,
};
const alertSettings = { alertDays: [5, 1], alertOnOverdue: true, extraRecipients: 'none' } as const;

function harness(tenantId: string | null = TENANT) {
  const userRpc = {
    call: vi.fn<(name: string, args: Record<string, unknown>, bearer: string) => Promise<unknown>>(
      async (name) => {
        if (name === 'list_notifications') return [notification];
        if (name === 'get_closing_alert_settings') return alertSettings;
        return true;
      },
    ),
  };
  const resolver: SessionResolver = {
    resolve: vi.fn<(sessionId: string) => Promise<Session | null>>(async (sessionId) => ({
      sessionId,
      userId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenantId,
      accessToken: 'caller-jwt',
      csrfToken: 'csrf-token',
    })),
  };
  const app = new Hono();
  const deps = {
    appOrigin: 'http://localhost:8080',
    cookieSecure: false,
    resolver,
    limiter: createRateLimiter(),
    logger: { info: vi.fn<() => void>(), error: vi.fn<() => void>() },
  };
  const routes = mountNotificationRoutes(app, deps, { userRpc });
  return { app, routes, userRpc, resolver };
}

describe('notification routes', () => {
  it('declares session-only access', () => {
    const { routes } = harness();
    expect(describeRoutes(routes)).toEqual([
      { method: 'GET', path: '/notifications', access: 'session' },
      { method: 'POST', path: '/notifications/:notificationId/read', access: 'session' },
      { method: 'GET', path: '/closing-alert-settings', access: 'session' },
      { method: 'PUT', path: '/closing-alert-settings', access: 'session' },
    ]);
  });

  it('reads a validated feed using the caller JWT and selected tenant', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/notifications', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([notification]);
    expect(userRpc.call).toHaveBeenCalledWith(
      'list_notifications',
      { p_tenant: TENANT, p_limit: 50 },
      'caller-jwt',
    );
  });

  it('requires a selected tenant before reading', async () => {
    const { app, userRpc } = harness(null);
    const response = await app.request('/notifications', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(409);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects signed-out reads', async () => {
    const { app, userRpc, resolver } = harness();
    const resolve = vi.fn<() => Promise<Session | null>>(async () => null);
    resolver.resolve = resolve;
    const response = await app.request('/notifications');
    expect(response.status).toBe(401);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('reads alert settings through the caller JWT and active tenant', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/closing-alert-settings', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(alertSettings);
    expect(userRpc.call).toHaveBeenCalledWith(
      'get_closing_alert_settings',
      { p_tenant: TENANT },
      'caller-jwt',
    );
  });

  it('requires a selected tenant before reading or updating alert settings', async () => {
    const { app, userRpc } = harness(null);
    const get = await app.request('/closing-alert-settings', { headers: { Cookie: COOKIE } });
    expect(get.status).toBe(409);
    const put = await app.request('/closing-alert-settings', {
      method: 'PUT',
      headers: {
        Cookie: COOKIE,
        Origin: 'http://localhost:8080',
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(alertSettings),
    });
    expect(put.status).toBe(409);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('updates settings through the caller JWT and rejects invalid input before the RPC', async () => {
    const { app, userRpc } = harness();
    const headers = {
      Cookie: COOKIE,
      Origin: 'http://localhost:8080',
      'X-CSRF-Token': 'csrf-token',
      'Content-Type': 'application/json',
    };
    const response = await app.request('/closing-alert-settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ alertDays: [10, 5, 1], alertOnOverdue: false, extraRecipients: 'ic' }),
    });
    expect(response.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'update_closing_alert_settings',
      {
        p_tenant: TENANT,
        p_alert_days: [10, 5, 1],
        p_alert_on_overdue: false,
        p_extra_recipients: 'ic',
      },
      'caller-jwt',
    );

    userRpc.call.mockClear();
    const invalid = await app.request('/closing-alert-settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ alertDays: [5, 5], alertOnOverdue: true, extraRecipients: 'none' }),
    });
    expect(invalid.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('marks read only through the caller-scoped database function', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/notifications/${ID}/read`, {
      method: 'POST',
      headers: { Cookie: COOKIE, Origin: 'http://localhost:8080', 'X-CSRF-Token': 'csrf-token' },
    });
    expect(response.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'mark_notification_read',
      { p_notification: ID },
      'caller-jwt',
    );
  });

  it('rejects malformed notification ids before calling the database', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/notifications/nope/read', {
      method: 'POST',
      headers: { Cookie: COOKIE, Origin: 'http://localhost:8080', 'X-CSRF-Token': 'csrf-token' },
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });
});
