import {
  assignableRolesResponseSchema,
  memberRoleBodySchema,
  teamMembersResponseSchema,
} from '@dpt/shared';
import { z } from 'zod';

import { HttpError } from '../../http/errors';
import { noBody, sessionRoute, type HttpDeps, type Route } from '../../http/route';

export interface MemberRoutesOptions {
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
}

function memberId(value: string | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'invalid_request', 'The member id is invalid.');
  return parsed.data;
}

function requireTenant(tenantId: string | null): string {
  if (!tenantId) {
    throw new HttpError(409, 'tenant_required', 'Choose an organisation to manage its members.');
  }
  return tenantId;
}

export function createMemberRoutes({ userRpc }: MemberRoutesOptions): Route[] {
  const listAssignableRoles = sessionRoute({
    method: 'GET',
    path: '/team/assignable-roles',
    body: noBody,
    permission: 'member.manage',
    handler: async ({ session }) => ({
      body: assignableRolesResponseSchema.parse(
        await userRpc.call(
          'tenant_invitable_roles',
          { p_tenant: requireTenant(session.tenantId) },
          session.accessToken,
        ),
      ),
    }),
  });

  const list = sessionRoute({
    method: 'GET',
    path: '/team/members',
    body: noBody,
    permission: 'member.manage',
    handler: async ({ session }) => ({
      body: teamMembersResponseSchema.parse(
        await userRpc.call(
          'tenant_members',
          { p_tenant: requireTenant(session.tenantId) },
          session.accessToken,
        ),
      ),
    }),
  });

  const grant = sessionRoute({
    method: 'POST',
    path: '/team/members/:userId/roles',
    body: memberRoleBodySchema,
    permission: 'member.manage',
    handler: async ({ body, params, session }) => {
      await userRpc.call(
        'grant_role',
        {
          p_tenant: requireTenant(session.tenantId),
          p_user: memberId(params.userId),
          p_role_key: body.roleKey,
        },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  const revoke = sessionRoute({
    method: 'DELETE',
    path: '/team/members/:userId/roles',
    body: memberRoleBodySchema,
    permission: 'member.manage',
    handler: async ({ body, params, session }) => {
      await userRpc.call(
        'revoke_role',
        {
          p_tenant: requireTenant(session.tenantId),
          p_user: memberId(params.userId),
          p_role_key: body.roleKey,
        },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  const deactivate = sessionRoute({
    method: 'DELETE',
    path: '/team/members/:userId',
    body: noBody,
    permission: 'member.manage',
    handler: async ({ params, session }) => {
      await userRpc.call(
        'deactivate_member',
        { p_tenant: requireTenant(session.tenantId), p_user: memberId(params.userId) },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  return [listAssignableRoles, list, grant, revoke, deactivate];
}

export function mountMemberRoutes(
  app: Parameters<Route['mount']>[0],
  deps: HttpDeps,
  options: MemberRoutesOptions,
): Route[] {
  const routes = createMemberRoutes(options);
  for (const route of routes) route.mount(app, deps);
  return routes;
}
