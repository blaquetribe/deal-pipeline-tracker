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

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
