import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../http/rate-limit';
import { describeRoutes, type Session, type SessionResolver } from '../../http/route';
import { createApprovalRoutes } from './routes';

const DEAL = 'bbbbbbbb-0000-4000-8000-000000000001';
const REQUEST = 'bbbbbbbb-0000-4000-8000-000000000002';
const TENANT = 'cccccccc-0000-4000-8000-000000000001';
const COOKIE = `dpt_session=${'A'.repeat(43)}`;

function harness(tenantId: string | null = TENANT) {
  const userRpc = {
    call: vi.fn<(name: string, args: Record<string, unknown>, bearer: string) => Promise<unknown>>(
      async (name) => {
        if (name === 'deal_approval_status') {
          return {
            requestId: null,
            status: null,
            requiredApprovals: null,
            configuredApprovals: 1,
            approvedCount: 0,
            pendingCount: 0,
            rejectedCount: 0,
            currentUserDecision: null,
            canRequest: true,
            canDecide: false,
            canConfigure: true,
          };
        }
        if (name === 'request_approval') return REQUEST;
        if (name === 'decide_approval') return 'pending';
        return null;
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
  const routes = createApprovalRoutes({ userRpc });
  for (const route of routes) route.mount(app, deps);
  return { app, routes, userRpc, resolver };
}

const jsonHeaders = {
  Cookie: COOKIE,
  Origin: 'http://localhost:8080',
  'X-CSRF-Token': 'csrf-token',
  'Content-Type': 'application/json',
};

describe('approval routes', () => {
  it('declares session access and database permissions for every operation', () => {
    const { routes } = harness();
    expect(describeRoutes(routes)).toEqual([
      { method: 'GET', path: '/deals/:dealId/approval', access: 'session' },
      { method: 'POST', path: '/deals/:dealId/approval-requests', access: 'session' },
      { method: 'POST', path: '/approval-requests/:requestId/decisions', access: 'session' },
      { method: 'PUT', path: '/approval-policy', access: 'session' },
    ]);
    expect(routes.map(({ permission }) => permission)).toEqual([
      'deal.view',
      'deal.request_approval',
      'approval.decide',
      'role.manage',
    ]);
  });

  it('reads caller-specific state through the user JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/approval`, { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canRequest: true });
    expect(userRpc.call).toHaveBeenCalledWith(
      'deal_approval_status',
      { p_deal: DEAL },
      'caller-jwt',
    );
  });

  it('rejects malformed deal ids before querying approval status', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/deals/not-a-uuid/approval', {
      headers: { Cookie: COOKIE },
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('requires a signed-in session before requesting approval', async () => {
    const { app, userRpc, resolver } = harness();
    resolver.resolve = vi.fn<(sessionId: string) => Promise<Session | null>>(async () => null);
    const response = await app.request(`/deals/${DEAL}/approval-requests`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedVersion: 2 }),
    });
    expect(response.status).toBe(401);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('submits with the expected version and authenticated token', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/approval-requests`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedVersion: 2 }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestId: REQUEST });
    expect(userRpc.call).toHaveBeenCalledWith(
      'request_approval',
      { p_deal: DEAL, p_expected_version: 2 },
      'caller-jwt',
    );
  });

  it('rejects malformed deal ids before creating an approval request', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/deals/not-a-uuid/approval-requests', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ expectedVersion: 2 }),
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects unknown decision fields before calling the database', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/approval-requests/${REQUEST}/decisions`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approve', actorId: 'client-controlled' }),
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('records an approval decision and defaults an omitted reason to null', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/approval-requests/${REQUEST}/decisions`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(userRpc.call).toHaveBeenCalledWith(
      'decide_approval',
      { p_request: REQUEST, p_decision: 'approve', p_reason: null },
      'caller-jwt',
    );
  });

  it('passes a supplied decision reason to the database', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/approval-requests/${REQUEST}/decisions`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'reject', reason: 'Insufficient diligence' }),
    });
    expect(response.status).toBe(200);
    expect(userRpc.call).toHaveBeenCalledWith(
      'decide_approval',
      { p_request: REQUEST, p_decision: 'reject', p_reason: 'Insufficient diligence' },
      'caller-jwt',
    );
  });

  it('rejects malformed approval request ids before writing a decision', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/approval-requests/not-a-uuid/decisions', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('configures quorum using the active tenant, never a body-supplied tenant', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/approval-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ requiredApprovals: 2 }),
    });
    expect(response.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'configure_approval_policy',
      { p_tenant: TENANT, p_required_approvals: 2 },
      'caller-jwt',
    );
  });

  it('requires a selected tenant to configure quorum', async () => {
    const { app, userRpc } = harness(null);
    const response = await app.request('/approval-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ requiredApprovals: 2 }),
    });
    expect(response.status).toBe(409);
    expect(userRpc.call).not.toHaveBeenCalled();
  });
});
