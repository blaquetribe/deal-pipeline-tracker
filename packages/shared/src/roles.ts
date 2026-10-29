import { z } from 'zod';

export const permissionSchema = z.strictObject({
  key: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/),
  description: z.string().min(1),
});

export const tenantRoleSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().regex(/^[a-z_]+$/),
  name: z.string().min(1).max(100),
  isSystem: z.boolean(),
  permissions: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/)),
});

export const tenantRolesCatalogResponseSchema = z.strictObject({
  canManageRoles: z.boolean(),
  roles: z.array(tenantRoleSchema),
  permissionCatalog: z.array(permissionSchema),
});

export const customRoleBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    permissions: z
      .array(z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/))
      .min(1)
      .max(64),
  })
  .refine(({ permissions }) => new Set(permissions).size === permissions.length, {
    path: ['permissions'],
    message: 'Choose each permission only once.',
  });

export const customRoleResponseSchema = z.strictObject({ roleId: z.uuid() });

export type TenantRole = z.infer<typeof tenantRoleSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type TenantRolesCatalogResponse = z.infer<typeof tenantRolesCatalogResponseSchema>;
export type CustomRoleBody = z.infer<typeof customRoleBodySchema>;
