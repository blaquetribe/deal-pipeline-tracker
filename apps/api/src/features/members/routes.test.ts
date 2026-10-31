import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../http/rate-limit';
import { describeRoutes, type SessionResolver } from '../../http/route';
import { createMemberRoutes } from './routes';

const COOKIE = `dpt_session=${'A'.repeat(43)}`;
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const MEMBERS = {
  members: [
    {
      userId: USER_ID,
      email: 'member@example.test',
      fullName: 'Example Member',
      deactivatedAt: null,
      roles: [{ key: 'deal_member', name: 'Deal Team Member', isSystem: true }],
    },
  ],
};

function harness({
  tenantId = TENANT_ID,
  authenticated = true,
}: { tenantId?: string | null; authenticated?: boolean } = {}) {
  const userRpc = {
    call: vi.fn<(name: string, args: Record<string, unknown>, bearer: string) => Promise<unknown>>(
      async (name) => (name === 'tenant_members' ? MEMBERS : undefined),
    ),
  };
  const resolver: SessionResolver = {
    resolve: vi.fn<SessionResolver['resolve']>(async () =>
      authenticated
        ? {
            sessionId: 'A'.repeat(43),
            userId: 'aaaaaaaa-0000-4000-8000-000000000001',
            tenantId,
            accessToken: 'caller-jwt',
            csrfToken: 'csrf-token',
          }
        : null,
    ),
  };
  const app = new Hono();
  const deps = {
    appOrigin: 'http://localhost:8080',
    cookieSecure: false,
    resolver,
    limiter: createRateLimiter(),
    logger: {
      info: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
      error: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
    },
  };
  const routes = createMemberRoutes({ userRpc });
  for (const route of routes) route.mount(app, deps);
  return { app, routes, userRpc };
}

const writeHeaders = {
  Cookie: COOKIE,
  Origin: 'http://localhost:8080',
  'X-CSRF-Token': 'csrf-token',
  'Content-Type': 'application/json',
};

describe('team member routes', () => {
  it('declares member management routes behind member.manage', () => {
    const { routes } = harness();
    expect(describeRoutes(routes)).toEqual([
      { method: 'GET', path: '/team/assignable-roles', access: 'session' },
      { method: 'GET', path: '/team/members', access: 'session' },
      { method: 'POST', path: '/team/members/:userId/roles', access: 'session' },
      { method: 'DELETE', path: '/team/members/:userId/roles', access: 'session' },
      { method: 'DELETE', path: '/team/members/:userId', access: 'session' },
    ]);
    expect(routes.map(({ permission }) => permission)).toEqual([
      'member.manage',
      'member.manage',
      'member.manage',
      'member.manage',
      'member.manage',
    ]);
  });

  it('reads only the caller-assignable tenant roles with the caller JWT', async () => {
    const choices = {
      canManageRoles: false,
      roles: [{ id: 'aaaaaaaa-0000-4000-8000-000000000004', key: 'deal_lead', name: 'Deal Lead' }],
    };
    const { app, userRpc } = harness();
    userRpc.call.mockResolvedValueOnce(choices);
    const response = await app.request('/team/assignable-roles', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(choices);
    expect(userRpc.call).toHaveBeenCalledWith(
      'tenant_invitable_roles',
      { p_tenant: TENANT_ID },
      'caller-jwt',
    );
  });

  it('reads a validated same-tenant member roster with the caller JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/team/members', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MEMBERS);
    expect(userRpc.call).toHaveBeenCalledWith(
      'tenant_members',
      { p_tenant: TENANT_ID },
      'caller-jwt',
    );
  });

  it('grants and revokes a role through guarded database functions', async () => {
    const { app, userRpc } = harness();
    const grant = await app.request(`/team/members/${USER_ID}/roles`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ roleKey: 'ic_member' }),
    });
    const revoke = await app.request(`/team/members/${USER_ID}/roles`, {
      method: 'DELETE',
      headers: writeHeaders,
      body: JSON.stringify({ roleKey: 'deal_member' }),
    });
    expect(grant.status).toBe(204);
    expect(revoke.status).toBe(204);
    expect(userRpc.call).toHaveBeenNthCalledWith(
      1,
      'grant_role',
      { p_tenant: TENANT_ID, p_user: USER_ID, p_role_key: 'ic_member' },
      'caller-jwt',
    );
    expect(userRpc.call).toHaveBeenNthCalledWith(
      2,
      'revoke_role',
      { p_tenant: TENANT_ID, p_user: USER_ID, p_role_key: 'deal_member' },
      'caller-jwt',
    );
  });

  it('deactivates a member through the database invariant', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/team/members/${USER_ID}`, {
      method: 'DELETE',
      headers: { ...writeHeaders, 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'deactivate_member',
      { p_tenant: TENANT_ID, p_user: USER_ID },
      'caller-jwt',
    );
  });

  it('requires a signed-in user before reading personally identifiable member data', async () => {
    const { app, userRpc } = harness({ authenticated: false });
    const response = await app.request('/team/members', { headers: { Cookie: COOKIE } });
    expect(response.status).toBe(401);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('requires an active tenant and rejects invalid targets before database access', async () => {
    const noTenantHarness = harness({ tenantId: null });
    const noTenant = await noTenantHarness.app.request('/team/members', {
      headers: { Cookie: COOKIE },
    });
    const { app, userRpc } = harness();
    const invalidUser = await app.request('/team/members/not-a-uuid/roles', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ roleKey: 'ic_member' }),
    });
    const invalidRole = await app.request(`/team/members/${USER_ID}/roles`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ roleKey: 'owner', tenantId: TENANT_ID }),
    });
    expect(noTenant.status).toBe(409);
    expect(invalidUser.status).toBe(400);
    expect(invalidRole.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
    expect(noTenantHarness.userRpc.call).not.toHaveBeenCalled();
  });
});
