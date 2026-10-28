import { z } from 'zod';

/**
 * The web/api contract for authentication. Bodies reject unknown fields so a client cannot smuggle in a
 * role, tenant or author (SECURITY_STANDARDS: never trust the client).
 */

// Passwords shorter than 12 characters are refused outright, so this list holds only the common
// passwords that would otherwise pass the length rule. A larger list is a README next step.
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'passwordpassword',
  'password1234',
  'password12345',
  'password123456',
  'passw0rdpassw0rd',
  '123456789012',
  '1234567890123',
  '12345678901234',
  'qwertyuiop12',
  'qwertyuiopasdf',
  'qwertyuiop123',
  'iloveyouiloveyou',
  'administrator',
  'changemechangeme',
  'welcome12345',
  'letmein123456',
  'abcdefghijkl',
  'abcd12345678',
  '111111111111',
  '000000000000',
]);

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), 'That password is too common');

/** 32 random bytes, base64url (43 characters, no padding). */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid token');

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signupBodySchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(100),
});

export const loginBodySchema = z.strictObject({
  email: emailSchema,
  // Not the sign-up policy: an existing account may predate it. Only bound the size.
  password: z.string().min(1).max(1024),
});

export const verifyBodySchema = z.strictObject({ token: tokenSchema });
export const resendBodySchema = z.strictObject({ email: emailSchema });
export const resetRequestBodySchema = z.strictObject({ email: emailSchema });
export const resetBodySchema = z.strictObject({ token: tokenSchema, password: passwordSchema });
export const invitationPreviewBodySchema = z.strictObject({ token: tokenSchema });
export const invitationAcceptBodySchema = z.strictObject({ token: tokenSchema });
export const invitationRegistrationBodySchema = z.strictObject({
  token: tokenSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(100),
});
export const inviteMemberBodySchema = z.strictObject({
  email: emailSchema,
  roleKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
});
export const revokeInvitationBodySchema = z.strictObject({ invitationId: z.uuid() });
export const tenantSelectionBodySchema = z.strictObject({ tenantId: z.uuid() });
export const profileBodySchema = z.strictObject({
  displayName: z.string().trim().min(1, { error: 'Enter a display name.' }).max(100),
  jobTitle: z.string().trim().max(100).nullable().optional(),
});
export const organisationBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().min(1).max(100).default('Africa/Johannesburg'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('ZAR'),
});
export const defaultsBodySchema = z.strictObject({
  timezone: z.string().min(1).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  closingSoonDays: z.number().int().min(1).max(365),
});
export const onboardingStepSchema = z.enum([
  'profile',
  'organisation',
  'defaults',
  'invite',
  'done',
]);
export const authSessionResponseSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email(), fullName: z.string().nullable() }),
  tenantId: z.uuid().nullable(),
  csrfToken: z.string().min(1),
});
export const tenantChoicesResponseSchema = z.object({
  activeTenantId: z.uuid().nullable(),
  tenants: z.array(z.object({ tenantId: z.uuid(), tenantName: z.string() })),
});
export const pendingInvitationsResponseSchema = z.object({
  invitations: z.array(
    z.strictObject({
      invitationId: z.uuid(),
      email: z.email(),
      roleKey: z.string(),
      createdAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
    }),
  ),
});
export const onboardingStateResponseSchema = z.object({
  onboarding: z
    .object({
      flow: z.enum(['owner', 'invitee']),
      current_step: onboardingStepSchema,
      completed: z.boolean(),
      skipped: z.array(onboardingStepSchema),
    })
    .nullable(),
});
export const invitationPreviewResponseSchema = z.object({
  tenantName: z.string(),
  inviterEmail: z.email(),
  roleName: z.string(),
  email: z.email(),
  organisationNameIsSelfDeclared: z.literal(true),
});
export const invitationRegistrationResponseSchema = z.object({
  accepted: z.boolean(),
  tenantId: z.uuid(),
  signInRequired: z.boolean(),
  csrfToken: z.string().optional(),
});

export type OnboardingStateResponse = z.infer<typeof onboardingStateResponseSchema>;
export type TenantChoicesResponse = z.infer<typeof tenantChoicesResponseSchema>;
export type PendingInvitationsResponse = z.infer<typeof pendingInvitationsResponseSchema>;
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponseSchema>;

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
