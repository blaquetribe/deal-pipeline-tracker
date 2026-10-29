import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../http/rate-limit';
import { describeRoutes, type SessionResolver } from '../../http/route';
import { createRoleRoutes, mountRoleRoutes } from './routes';

const COOKIE = `dpt_session=${'A'.repeat(43)}`;
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const ROLE_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const CATALOG = {
  canManageRoles: true,
  roles: [
    {
      id: ROLE_ID,
      key: 'custom_abcdefgh',
      name: 'Deal Reviewer',
      isSystem: false,
      permissions: ['deal.view'],
    },
  ],
  permissionCatalog: [{ key: 'deal.view', description: 'See deals and their ledger' }],
};

function harness({ tenantId = TENANT_ID }: { tenantId?: string | null } = {}) {
  const userRpc = {
    call: vi.fn<(name: string, args: Record<string, unknown>, bearer: string) => Promise<unknown>>(
      async (name) => (name === 'tenant_roles_catalog' ? CATALOG : ROLE_ID),
    ),
  };
  const resolver: SessionResolver = {
    resolve: vi.fn<SessionResolver['resolve']>(async () => ({
      sessionId: 'A'.repeat(43),
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
    logger: {
      info: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
      error: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
    },
  };
  const routes = createRoleRoutes({ userRpc });
  for (const route of routes) route.mount(app, deps);
  return { app, routes, userRpc };
}

const writeHeaders = {
  Cookie: COOKIE,
  Origin: 'http://localhost:8080',
  'X-CSRF-Token': 'csrf-token',
  'Content-Type': 'application/json',
};

describe('role routes', () => {
  it('declares a session read and role-managed writes', () => {
    const { routes } = harness();
    expect(describeRoutes(routes)).toEqual([
      { method: 'GET', path: '/roles', access: 'session' },
      { method: 'POST', path: '/roles', access: 'session' },
      { method: 'PUT', path: '/roles/:roleId', access: 'session' },
    ]);
    expect(routes.map(({ permission }) => permission)).toEqual([
      undefined,
      'role.manage',
      'role.manage',
    ]);
  });

  it('mounts every role route on the API app', () => {
    const app = new Hono();
    const dependencies = {
      appOrigin: 'http://localhost:8080',
      cookieSecure: false,
      resolver: { resolve: vi.fn<SessionResolver['resolve']>(async () => null) },
      limiter: createRateLimiter(),
      logger: {
        info: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
        error: vi.fn<(message: string, fields?: Record<string, unknown>) => void>(),
      },
    };

    const routes = mountRoleRoutes(app, dependencies, {
      userRpc: {
        call: vi.fn<
          (name: string, args: Record<string, unknown>, bearer: string) => Promise<unknown>
        >(async () => CATALOG),
      },
    });

    expect(routes).toHaveLength(3);
  });

  it('reads the caller tenant role catalog with the caller JWT', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/roles', { headers: { Cookie: COOKIE } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CATALOG);
    expect(userRpc.call).toHaveBeenCalledWith(
      'tenant_roles_catalog',
      { p_tenant: TENANT_ID },
      'caller-jwt',
    );
  });

  it('creates a role with validated name and permissions', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/roles', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Deal Reviewer', permissions: ['deal.view'] }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ roleId: ROLE_ID });
    expect(userRpc.call).toHaveBeenCalledWith(
      'save_custom_role',
      { p_tenant: TENANT_ID, p_role: null, p_name: 'Deal Reviewer', p_permissions: ['deal.view'] },
      'caller-jwt',
    );
  });

  it('updates an existing custom role through the caller-scoped function', async () => {
    const { app, userRpc } = harness();
    const response = await app.request(`/roles/${ROLE_ID}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Senior Reviewer', permissions: ['deal.view'] }),
    });

    expect(response.status).toBe(204);
    expect(userRpc.call).toHaveBeenCalledWith(
      'save_custom_role',
      {
        p_tenant: TENANT_ID,
        p_role: ROLE_ID,
        p_name: 'Senior Reviewer',
        p_permissions: ['deal.view'],
      },
      'caller-jwt',
    );
  });

  it('requires a tenant before updating a role', async () => {
    const { app, userRpc } = harness({ tenantId: null });
    const response = await app.request(`/roles/${ROLE_ID}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Senior Reviewer', permissions: ['deal.view'] }),
    });

    expect(response.status).toBe(409);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects invalid role payloads and ids before calling the database', async () => {
    const { app, userRpc } = harness();
    const invalidBody = await app.request('/roles', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Empty', permissions: [], tenantId: TENANT_ID }),
    });
    const invalidId = await app.request('/roles/not-a-uuid', {
      method: 'PUT',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Valid', permissions: ['deal.view'] }),
    });

    expect(invalidBody.status).toBe(400);
    expect(invalidId.status).toBe(400);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('requires an active tenant for reads and writes', async () => {
    const { app, userRpc } = harness({ tenantId: null });
    const read = await app.request('/roles', { headers: { Cookie: COOKIE } });
    const write = await app.request('/roles', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Deal Reviewer', permissions: ['deal.view'] }),
    });

    expect(read.status).toBe(409);
    expect(write.status).toBe(409);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('requires a signed-in session to read the role catalog', async () => {
    const { app, userRpc } = harness();
    const response = await app.request('/roles');

    expect(response.status).toBe(401);
    expect(userRpc.call).not.toHaveBeenCalled();
  });
});
