import { dealListResponseSchema } from '@dpt/shared';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../http/rate-limit';
import { describeRoutes, type SessionResolver } from '../../http/route';
import { createDealRoutes } from './routes';

const ORIGIN = 'http://localhost:8080';
const DEAL = 'bbbbbbbb-0000-4000-8000-000000000001';
const CREATED_DEAL = 'bbbbbbbb-0000-4000-8000-000000000002';
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const SESSION_COOKIE = `dpt_session=${'A'.repeat(43)}`;

function typedMock<T extends (...args: never[]) => unknown>(implementation: T) {
  return vi.fn<T>(implementation);
}

function harness(tenantId: string | null = 'cccccccc-0000-4000-8000-000000000001') {
  const userRpc = {
    call: typedMock(async (name: string, _args: Record<string, unknown>, _bearer: string) => {
      if (name === 'list_deals') {
        return {
          total: 1,
          items: [
            {
              id: DEAL,
              name: 'Northstar Systems',
              stage: 'sourcing',
              version: 1,
              sector: 'Technology',
              amount: '123456789012345',
              currency: 'ZAR',
              expected_close_date: '2027-03-31',
              expected_close_time: null,
              created_at: '2026-10-28T10:00:00+00:00',
            },
          ],
        };
      }
      if (name === 'deal_detail') {
        return {
          id: DEAL,
          name: 'Northstar Systems',
          stage: 'sourcing',
          version: 1,
          sector: 'Technology',
          amount: '123456789012345',
          currency: 'ZAR',
          expected_close_date: '2027-03-31',
          expected_close_time: null,
          created_at: '2026-10-28T10:00:00+00:00',
        };
      }
      if (name === 'deal_dashboard_summary') {
        return {
          serverNow: '2026-10-28T10:00:00+00:00',
          nextMidnightAt: '2026-10-28T21:00:00+00:00',
          timeZone: 'Africa/Johannesburg',
          windowDays: 60,
          pipelineByStage: [{ stage: 'sourcing', count: 1 }],
          totalsByCurrency: [{ currency: 'ZAR', amount: '123456789012345' }],
          closingSoonCount: 1,
          closingSoon: [
            {
              id: DEAL,
              name: 'Northstar Systems',
              stage: 'sourcing',
              amount: '123456789012345',
              currency: 'ZAR',
              expectedCloseDate: '2026-10-29',
              expectedCloseTime: '14:30:00',
              closesInDays: 1,
              closesAt: '2026-10-29T14:30:00+02:00',
            },
          ],
        };
      }
      if (name === 'deal_activity') {
        return {
          events: [
            {
              seq: '9007199254740993',
              id: 'bbbbbbbb-0000-4000-8000-000000000001',
              kind: 'note',
              body: 'Plain text note',
              actor_id: USER,
              actor_name: 'Test User',
              actor_email: 'person@example.test',
              created_at: '2026-10-28T10:00:00+00:00',
              amends_event_id: null,
            },
          ],
          hasMore: false,
          integrityOk: true,
        };
      }
      if (name === 'deal_assignees_for_deal') {
        return [{ user_id: USER, role: 'owner', assigned_at: '2026-10-28T10:00:00+00:00' }];
      }
      if (name === 'create_deal') return CREATED_DEAL;
      if (name === 'update_deal') return 4;
      if (name === 'post_event') return 'bbbbbbbb-0000-4000-8000-000000000002';
      return 2;
    }),
  };
  const resolver: SessionResolver = {
    resolve: typedMock(async (sessionId: string) => ({
      sessionId,
      userId: USER,
      tenantId,
      accessToken: 'user-jwt',
      csrfToken: 'csrf-token',
    })),
  };
  const app = new Hono();
  const deps = {
    appOrigin: ORIGIN,
    cookieSecure: false,
    resolver,
    limiter: createRateLimiter(),
    logger: { info: typedMock(() => undefined), error: typedMock(() => undefined) },
  };
  const routes = createDealRoutes({ userRpc });
  for (const route of routes) route.mount(app, deps);
  return { app, routes, userRpc, resolver };
}

describe('deal assignment routes', () => {
  it('declares session and permission requirements for list and replace operations', () => {
    const { routes } = harness();
    expect(describeRoutes(routes)).toEqual([
      { method: 'POST', path: '/deals', access: 'session' },
      { method: 'GET', path: '/deals', access: 'session' },
      { method: 'GET', path: '/deals/dashboard-summary', access: 'session' },
      { method: 'GET', path: '/deals/:dealId', access: 'session' },
      { method: 'PUT', path: '/deals/:dealId', access: 'session' },
      { method: 'POST', path: '/deals/:dealId/stage', access: 'session' },
      { method: 'GET', path: '/deals/:dealId/activity', access: 'session' },
      { method: 'POST', path: '/deals/:dealId/notes', access: 'session' },
      { method: 'GET', path: '/deals/:dealId/assignees', access: 'session' },
      { method: 'PUT', path: '/deals/:dealId/assignees', access: 'session' },
    ]);
    expect(routes.map((route) => route.permission)).toEqual([
      'deal.create',
      'deal.view',
      'deal.view',
      'deal.view',
      'deal.edit',
      'deal.edit',
      'deal.view',
      'deal.note',
      'deal.view',
      'deal.edit',
    ]);
  });

  it('reads the active tenant dashboard summary through the user JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/deals/dashboard-summary', {
      headers: { Cookie: SESSION_COOKIE },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      timeZone: 'Africa/Johannesburg',
      windowDays: 60,
      closingSoon: [{ id: DEAL, closesInDays: 1 }],
    });
    expect(userRpc.call).toHaveBeenCalledWith(
      'deal_dashboard_summary',
      { p_tenant: 'cccccccc-0000-4000-8000-000000000001' },
      'user-jwt',
    );
  });

  it('requires a session before querying assignments', async () => {
    const { app, userRpc, resolver } = harness();
    resolver.resolve = typedMock(async () => null);
    const response = await app.request(`/deals/${DEAL}/assignees`);
    expect(response.status).toBe(401);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('maps the database assignment response and uses the caller JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/assignees`, {
      headers: { Cookie: SESSION_COOKIE },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assignees: [{ userId: USER, role: 'owner', assignedAt: '2026-10-28T10:00:00+00:00' }],
    });
    expect(userRpc.call).toHaveBeenCalledWith(
      'deal_assignees_for_deal',
      { p_deal: DEAL },
      'user-jwt',
    );
  });

  it('creates a deal with the active session tenant and exact minor-unit amount', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/deals', {
      method: 'POST',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Northstar Systems',
        sector: 'Technology',
        amount: '123456789012345',
        expectedCloseDate: '2027-03-31',
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ dealId: CREATED_DEAL });
    expect(userRpc.call).toHaveBeenCalledWith(
      'create_deal',
      {
        p_tenant: 'cccccccc-0000-4000-8000-000000000001',
        p_name: 'Northstar Systems',
        p_sector: 'Technology',
        p_amount: '123456789012345',
        p_currency: 'ZAR',
        p_expected_close: '2027-03-31',
      },
      'user-jwt',
    );
  });

  it('requires an active tenant and rejects client-supplied tenant or floating-point money', async () => {
    const withoutTenant = harness(null);
    const noTenant = await withoutTenant.app.request('/deals', {
      method: 'POST',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Northstar' }),
    });
    expect(noTenant.status).toBe(409);
    expect(withoutTenant.userRpc.call).not.toHaveBeenCalled();

    const { app, userRpc } = harness();
    const invalid = await app.request('/deals', {
      method: 'POST',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Northstar',
        tenantId: 'dddddddd-0000-4000-8000-000000000001',
        amount: 12.5,
      }),
    });
    expect(invalid.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('lists deals for the active session tenant with server-side filters', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/deals?stage=sourcing&search=north&limit=10', {
      headers: { Cookie: SESSION_COOKIE },
    });
    expect(response.status).toBe(200);
    const body = dealListResponseSchema.parse(await response.json());
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: DEAL,
      name: 'Northstar Systems',
      amount: '123456789012345',
      stage: 'sourcing',
    });
    expect(userRpc.call).toHaveBeenCalledWith(
      'list_deals',
      {
        p_tenant: 'cccccccc-0000-4000-8000-000000000001',
        p_stage: 'sourcing',
        p_search: 'north',
        p_limit: 10,
        p_offset: 0,
      },
      'user-jwt',
    );
  });

  it('moves a deal through the database stage machine with optimistic versioning', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/stage`, {
      method: 'POST',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ toStage: 'screening', expectedVersion: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 2 });
    expect(userRpc.call).toHaveBeenCalledWith(
      'move_stage',
      { p_deal: DEAL, p_to: 'screening', p_expected_version: 1, p_reason: null },
      'user-jwt',
    );
  });

  it('updates deal fields with the user JWT, a strict allow-list and optimistic versioning', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}`, {
      method: 'PUT',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedVersion: 3,
        name: 'Northstar II',
        amount: '1234',
        expectedCloseTime: '14:30',
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 4 });
    expect(userRpc.call).toHaveBeenCalledWith(
      'update_deal',
      {
        p_deal: DEAL,
        p_expected_version: 3,
        p_changes: { name: 'Northstar II', amount: '1234', expected_close_time: '14:30' },
      },
      'user-jwt',
    );
  });

  it('reads tenant-authorized detail and maps exact bigint fields', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}`, { headers: { Cookie: SESSION_COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: DEAL, amount: '123456789012345' });
    expect(userRpc.call).toHaveBeenCalledWith('deal_detail', { p_deal: DEAL }, 'user-jwt');
  });

  it('reads activity with exact sequence cursors and integrity status', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(
      `/deals/${DEAL}/activity?limit=10&beforeSeq=9007199254740993`,
      {
        headers: { Cookie: SESSION_COOKIE },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      events: [{ seq: '9007199254740993', actorId: USER, body: 'Plain text note' }],
      hasMore: false,
      integrityOk: true,
    });
    expect(userRpc.call).toHaveBeenCalledWith(
      'deal_activity',
      { p_deal: DEAL, p_limit: 10, p_before_seq: '9007199254740993' },
      'user-jwt',
    );
  });

  it('posts a trimmed note through the append-only database function', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/notes`, {
      method: 'POST',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: '  Confidential note  ' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ eventId: 'bbbbbbbb-0000-4000-8000-000000000002' });
    expect(userRpc.call).toHaveBeenCalledWith(
      'post_event',
      { p_deal: DEAL, p_kind: 'note', p_body: 'Confidential note' },
      'user-jwt',
    );
  });

  it('rejects an invalid stage move body before calling the database', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/stage`, {
      method: 'POST',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ toStage: 'signed', expectedVersion: 1, tenantId: 'forged' }),
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects repeated and unknown list filters before calling the database', async () => {
    const { app, userRpc } = harness();
    const repeated = await app.request('/deals?stage=sourcing&stage=screening', {
      headers: { Cookie: SESSION_COOKIE },
    });
    const unknown = await app.request('/deals?tenantId=bbbbbbbb-0000-4000-8000-000000000001', {
      headers: { Cookie: SESSION_COOKIE },
    });
    expect(repeated.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects malformed deal ids before making an RPC call', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/deals/not-a-uuid/assignees', {
      headers: { Cookie: SESSION_COOKIE },
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('requires same-origin CSRF protection and rejects client tenant fields', async () => {
    const { app, userRpc } = harness();
    const noCsrf = await app.request(`/deals/${DEAL}/assignees`, {
      method: 'PUT',
      headers: { Cookie: SESSION_COOKIE, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, assignees: [] }),
    });
    expect(noCsrf.status).toBe(403);
    const badBody = await app.request(`/deals/${DEAL}/assignees`, {
      method: 'PUT',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 1,
        tenantId: 'cccccccc-0000-4000-8000-000000000001',
        assignees: [],
      }),
    });
    expect(badBody.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('replaces assignments through the user JWT and returns the new version', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/deals/${DEAL}/assignees`, {
      method: 'PUT',
      headers: {
        Cookie: SESSION_COOKIE,
        Origin: ORIGIN,
        'X-CSRF-Token': 'csrf-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: 1, assignees: [{ userId: USER, role: 'owner' }] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 2 });
    expect(userRpc.call).toHaveBeenCalledWith(
      'set_deal_assignees',
      {
        p_deal: DEAL,
        p_expected_version: 1,
        p_assignments: [{ user_id: USER, role: 'owner' }],
      },
      'user-jwt',
    );
  });
});
