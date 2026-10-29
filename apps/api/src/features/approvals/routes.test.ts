import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../http/rate-limit';
import { describeRoutes, type Session, type SessionResolver } from '../../http/route';
import { createApprovalRoutes } from './routes';

const DEAL = 'bbbbbbbb-0000-4000-8000-000000000001';
const REQUEST = 'bbbbbbbb-0000-4000-8000-000000000002';
const ABSENCE = 'bbbbbbbb-0000-4000-8000-000000000003';
const IC_MEMBER = 'dddddddd-0000-4000-8000-000000000001';
const REPLACEMENT = 'dddddddd-0000-4000-8000-000000000002';
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
            delegatedSlots: [],
            canRequest: true,
            canDecide: false,
            canConfigure: true,
            canManageAbsence: true,
            canReassign: false,
          };
        }
        if (name === 'request_approval') return REQUEST;
        if (name === 'decide_approval') return 'pending';
        if (name === 'set_approval_absence') return ABSENCE;
        if (name === 'get_approval_policy')
          return { requiredApprovals: 2, delegationEnabled: true };
        if (name === 'my_approval_absences') return [];
        if (name === 'my_approval_delegations' || name === 'eligible_approval_delegates') return [];
        if (name === 'set_approval_delegation') return ABSENCE;
        if (name === 'approval_reassignment_options') {
          return { unavailableApprovers: [], eligibleReplacements: [] };
        }
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
      { method: 'GET', path: '/approval-policy', access: 'session' },
      { method: 'GET', path: '/approval-absences', access: 'session' },
      { method: 'POST', path: '/approval-absences', access: 'session' },
      { method: 'DELETE', path: '/approval-absences/:absenceId', access: 'session' },
      { method: 'GET', path: '/approval-delegations', access: 'session' },
      { method: 'GET', path: '/approval-delegation-options', access: 'session' },
      { method: 'POST', path: '/approval-delegations', access: 'session' },
      { method: 'DELETE', path: '/approval-delegations/:delegationId', access: 'session' },
      {
        method: 'GET',
        path: '/approval-requests/:requestId/reassignment-options',
        access: 'session',
      },
      { method: 'POST', path: '/approval-requests/:requestId/reassignments', access: 'session' },
    ]);
    expect(routes.map(({ permission }) => permission)).toEqual([
      'deal.view',
      'deal.request_approval',
      'approval.decide',
      'role.manage',
      'role.manage',
      'approval.decide',
      'approval.decide',
      'approval.decide',
      'approval.decide',
      'approval.decide',
      'approval.decide',
      'approval.decide',
      'member.manage',
      'member.manage',
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
      { p_request: REQUEST, p_decision: 'approve', p_reason: null, p_on_behalf_of: null },
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
      {
        p_request: REQUEST,
        p_decision: 'reject',
        p_reason: 'Insufficient diligence',
        p_on_behalf_of: null,
      },
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

  it('reads the active tenant approval policy with the caller JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/approval-policy', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requiredApprovals: 2, delegationEnabled: true });
    expect(userRpc.call).toHaveBeenCalledWith(
      'get_approval_policy',
      { p_tenant: TENANT },
      'caller-jwt',
    );
  });

  it('passes explicit delegation configuration and creates delegation for selected tenant', async () => {
    const { app, userRpc } = harness();
    const configured = await app.request('/approval-policy', {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ requiredApprovals: 2, delegationEnabled: true }),
    });
    expect(configured.status).toBe(204);
    expect(userRpc.call).toHaveBeenLastCalledWith(
      'configure_approval_policy',
      {
        p_tenant: TENANT,
        p_required_approvals: 2,
        p_delegation_enabled: true,
      },
      'caller-jwt',
    );

    const created = await app.request('/approval-delegations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        delegateMembershipId: REPLACEMENT,
        startsAt: '2027-03-01T09:00:00Z',
        endsAt: '2027-03-03T17:00:00Z',
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ delegationId: ABSENCE });
    expect(userRpc.call).toHaveBeenLastCalledWith(
      'set_approval_delegation',
      {
        p_tenant: TENANT,
        p_delegate: REPLACEMENT,
        p_starts_at: '2027-03-01T09:00:00Z',
        p_ends_at: '2027-03-03T17:00:00Z',
      },
      'caller-jwt',
    );
  });

  it('reads delegation records and eligible choices with the selected tenant and caller JWT', async () => {
    const { app, userRpc } = harness();
    const records = await app.request('/approval-delegations', { headers: { Cookie: COOKIE } });
    expect(records.status).toBe(200);
    expect(await records.json()).toEqual([]);
    expect(userRpc.call).toHaveBeenLastCalledWith(
      'my_approval_delegations',
      { p_tenant: TENANT },
      'caller-jwt',
    );

    const options = await app.request('/approval-delegation-options', {
      headers: { Cookie: COOKIE },
    });
    expect(options.status).toBe(200);
    expect(await options.json()).toEqual([]);
    expect(userRpc.call).toHaveBeenLastCalledWith(
      'eligible_approval_delegates',
      { p_tenant: TENANT },
      'caller-jwt',
    );
  });

  it('requires a selected tenant for delegation reads and creation', async () => {
    const { app, userRpc } = harness(null);
    const records = await app.request('/approval-delegations', { headers: { Cookie: COOKIE } });
    expect(records.status).toBe(409);
    const options = await app.request('/approval-delegation-options', {
      headers: { Cookie: COOKIE },
    });
    expect(options.status).toBe(409);
    const created = await app.request('/approval-delegations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        delegateMembershipId: REPLACEMENT,
        startsAt: '2027-03-01T09:00:00Z',
        endsAt: '2027-03-03T17:00:00Z',
      }),
    });
    expect(created.status).toBe(409);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects invalid delegation windows and revokes valid delegation ids', async () => {
    const { app, userRpc } = harness();
    const invalidWindow = await app.request('/approval-delegations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        delegateMembershipId: REPLACEMENT,
        startsAt: '2027-03-02T09:00:00Z',
        endsAt: '2027-03-01T09:00:00Z',
      }),
    });
    expect(invalidWindow.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();

    const invalidId = await app.request('/approval-delegations/not-a-uuid', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    expect(invalidId.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();

    const revoked = await app.request(`/approval-delegations/${ABSENCE}`, {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    expect(revoked.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'cancel_approval_delegation',
      { p_delegation: ABSENCE },
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

  it('reads absence windows for the selected tenant using the caller JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/approval-absences', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(userRpc.call).toHaveBeenCalledWith(
      'my_approval_absences',
      { p_tenant: TENANT },
      'caller-jwt',
    );
  });

  it('schedules an absence without accepting a client tenant or membership', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/approval-absences', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        startsAt: '2027-03-01T09:00:00Z',
        endsAt: '2027-03-03T17:00:00Z',
        tenantId: 'client-controlled',
      }),
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('schedules a valid absence in the selected tenant', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/approval-absences', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ startsAt: '2027-03-01T09:00:00Z', endsAt: '2027-03-03T17:00:00Z' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ absenceId: ABSENCE });
    expect(userRpc.call).toHaveBeenCalledWith(
      'set_approval_absence',
      {
        p_tenant: TENANT,
        p_starts_at: '2027-03-01T09:00:00Z',
        p_ends_at: '2027-03-03T17:00:00Z',
      },
      'caller-jwt',
    );
  });

  it('cancels only a well-formed absence id through the user RPC', async () => {
    const { app, userRpc } = harness();
    const invalid = await app.request('/approval-absences/not-a-uuid', {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    expect(invalid.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
    const response = await app.request(`/approval-absences/${ABSENCE}`, {
      method: 'DELETE',
      headers: jsonHeaders,
    });
    expect(response.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'cancel_approval_absence',
      { p_absence: ABSENCE },
      'caller-jwt',
    );
  });

  it('reads replacement choices and performs reassignment without trusting a request id in the body', async () => {
    const { app, userRpc } = harness();
    const options = await app.request(`/approval-requests/${REQUEST}/reassignment-options`, {
      headers: { Cookie: COOKIE },
    });
    expect(options.status).toBe(200);
    expect(await options.json()).toEqual({ unavailableApprovers: [], eligibleReplacements: [] });
    expect(userRpc.call).toHaveBeenCalledWith(
      'approval_reassignment_options',
      { p_request: REQUEST },
      'caller-jwt',
    );

    const response = await app.request(`/approval-requests/${REQUEST}/reassignments`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        fromMembershipId: IC_MEMBER,
        toMembershipId: REPLACEMENT,
        requestId: 'client-controlled',
      }),
    });
    expect(response.status).toBe(400);
    expect(userRpc.call).toHaveBeenCalledTimes(1);
    const valid = await app.request(`/approval-requests/${REQUEST}/reassignments`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ fromMembershipId: IC_MEMBER, toMembershipId: REPLACEMENT }),
    });
    expect(valid.status).toBe(204);
    expect(userRpc.call).toHaveBeenLastCalledWith(
      'reassign_approval_approver',
      {
        p_request: REQUEST,
        p_from: IC_MEMBER,
        p_to: REPLACEMENT,
      },
      'caller-jwt',
    );
  });
});
