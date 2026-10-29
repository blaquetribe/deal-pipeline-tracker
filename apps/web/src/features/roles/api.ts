import {
  customRoleBodySchema,
  customRoleResponseSchema,
  tenantRolesCatalogResponseSchema,
  type CustomRoleBody,
  type TenantRolesCatalogResponse,
} from '@dpt/shared';

import { sessionRead, sessionRequest } from '../auth';

export async function readRoleCatalog(): Promise<TenantRolesCatalogResponse> {
  return tenantRolesCatalogResponseSchema.parse(await sessionRead('/roles'));
}

export async function createCustomRole(input: CustomRoleBody): Promise<string> {
  const body = customRoleBodySchema.parse(input);
  const response = customRoleResponseSchema.parse(await sessionRequest('/roles', 'POST', body));
  return response.roleId;
}

export async function updateCustomRole(roleId: string, input: CustomRoleBody): Promise<void> {
  const body = customRoleBodySchema.parse(input);
  await sessionRequest(`/roles/${encodeURIComponent(roleId)}`, 'PUT', body);
}
