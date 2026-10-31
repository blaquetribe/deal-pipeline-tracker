import {
  customRoleBodySchema,
  customRoleResponseSchema,
  tenantRolesCatalogResponseSchema,
} from '@dpt/shared';
import { z } from 'zod';

import { HttpError } from '../../http/errors';
import { noBody, sessionRoute, type HttpDeps, type Route } from '../../http/route';

export interface RoleRoutesOptions {
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
}

export function createRoleRoutes({ userRpc }: RoleRoutesOptions): Route[] {
  const list = sessionRoute({
    method: 'GET',
    path: '/roles',
    body: noBody,
    permission: 'role.manage',
    handler: async ({ session }) => {
      if (!session.tenantId) {
        throw new HttpError(409, 'tenant_required', 'Choose an organisation to view its roles.');
      }
      return {
        body: tenantRolesCatalogResponseSchema.parse(
          await userRpc.call(
            'tenant_roles_catalog',
            { p_tenant: session.tenantId },
            session.accessToken,
          ),
        ),
      };
    },
  });

  const create = sessionRoute({
    method: 'POST',
    path: '/roles',
    body: customRoleBodySchema,
    permission: 'role.manage',
    handler: async ({ body, session }) => {
      if (!session.tenantId) {
        throw new HttpError(409, 'tenant_required', 'Choose an organisation to create a role.');
      }
      const roleId = z.uuid().parse(
        await userRpc.call(
          'save_custom_role',
          {
            p_tenant: session.tenantId,
            p_role: null,
            p_name: body.name,
            p_permissions: body.permissions,
          },
          session.accessToken,
        ),
      );
      return { status: 201, body: customRoleResponseSchema.parse({ roleId }) };
    },
  });

  const update = sessionRoute({
    method: 'PUT',
    path: '/roles/:roleId',
    body: customRoleBodySchema,
    permission: 'role.manage',
    handler: async ({ body, params, session }) => {
      const roleId = z.uuid().safeParse(params.roleId);
      if (!roleId.success) {
        throw new HttpError(400, 'invalid_request', 'The role id is invalid.');
      }
      if (!session.tenantId) {
        throw new HttpError(409, 'tenant_required', 'Choose an organisation to update a role.');
      }
      await userRpc.call(
        'save_custom_role',
        {
          p_tenant: session.tenantId,
          p_role: roleId.data,
          p_name: body.name,
          p_permissions: body.permissions,
        },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  return [list, create, update];
}

export function mountRoleRoutes(
  app: Parameters<Route['mount']>[0],
  deps: HttpDeps,
  options: RoleRoutesOptions,
): Route[] {
  const routes = createRoleRoutes(options);
  for (const route of routes) route.mount(app, deps);
  return routes;
}
