import { describe, expect, it } from 'vitest';

import { customRoleBodySchema, tenantRolesCatalogResponseSchema } from './roles';

describe('custom role contracts', () => {
  it('trims role names and accepts a unique permission set', () => {
    expect(
      customRoleBodySchema.parse({ name: '  Deal Reviewer  ', permissions: ['deal.view'] }),
    ).toEqual({
      name: 'Deal Reviewer',
      permissions: ['deal.view'],
    });
  });

  it.each([
    { name: '', permissions: ['deal.view'] },
    { name: 'No access', permissions: [] },
    { name: 'Duplicates', permissions: ['deal.view', 'deal.view'] },
    { name: 'Unknown format', permissions: ['not a permission'] },
    { name: 'Unexpected field', permissions: ['deal.view'], tenantId: 'client-controlled' },
  ])('rejects invalid role payloads: %o', (payload) => {
    expect(customRoleBodySchema.safeParse(payload).success).toBe(false);
  });

  it('validates catalog entries and role read permissions', () => {
    expect(
      tenantRolesCatalogResponseSchema.safeParse({
        canManageRoles: true,
        roles: [
          {
            id: 'aaaaaaaa-0000-4000-8000-000000000001',
            key: 'custom_abcdefgh',
            name: 'Deal Reviewer',
            isSystem: false,
            permissions: ['deal.view'],
          },
        ],
        permissionCatalog: [{ key: 'deal.view', description: 'See deals' }],
      }).success,
    ).toBe(true);
  });
});
