import { describe, expect, it } from 'vitest';

import {
  loginBodySchema,
  invitationPreviewBodySchema,
  invitationRegistrationBodySchema,
  inviteMemberBodySchema,
  organisationBodySchema,
  profileBodySchema,
  defaultsBodySchema,
  passwordSchema,
  resendBodySchema,
  resetBodySchema,
  signupBodySchema,
  tenantChoicesResponseSchema,
  pendingInvitationsResponseSchema,
  tenantSelectionBodySchema,
  tokenSchema,
} from './auth';

describe('passwordSchema', () => {
  it('accepts a 12 character password', () => {
    expect(passwordSchema.safeParse('correct-horse').success).toBe(true);
  });

  it.each(['short', '12345678901', ''])('rejects %j as too short', (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse('a-b'.repeat(40) + 'x').success).toBe(true);
  });

  it.each(['passwordpassword', 'PasswordPassword', '123456789012', 'qwertyuiop12'])(
    'rejects the common password %s regardless of case',
    (value) => {
      expect(passwordSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects non-strings', () => {
    expect(passwordSchema.safeParse(123_456_789_012).success).toBe(false);
  });
});

describe('tokenSchema', () => {
  it('accepts a 43 character base64url token', () => {
    expect(tokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
  });

  it.each([
    '',
    'short',
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(42)}+`,
    `${'A'.repeat(42)} `,
  ])('rejects %j', (value) => {
    expect(tokenSchema.safeParse(value).success).toBe(false);
  });
});

describe('request bodies', () => {
  const valid = {
    email: ' Ada@Example.COM ',
    password: 'correct-horse',
    fullName: ' Ada Lovelace ',
  };

  it('normalises the email and trims the name on sign-up', () => {
    expect(signupBodySchema.parse(valid)).toEqual({
      email: 'ada@example.com',
      password: 'correct-horse',
      fullName: 'Ada Lovelace',
    });
  });

  it('rejects unknown fields (mass assignment)', () => {
    expect(signupBodySchema.safeParse({ ...valid, role: 'owner' }).success).toBe(false);
    expect(
      loginBodySchema.safeParse({ email: 'a@b.co', password: 'x', tenantId: 'y' }).success,
    ).toBe(false);
  });

  it('rejects a malformed email and an empty name', () => {
    expect(signupBodySchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(signupBodySchema.safeParse({ ...valid, fullName: '   ' }).success).toBe(false);
    expect(signupBodySchema.safeParse({ ...valid, fullName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('does not apply the password policy to login (existing accounts must be able to try)', () => {
    expect(loginBodySchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginBodySchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(loginBodySchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(1025) }).success).toBe(
      false,
    );
  });

  it('validates resend and reset bodies', () => {
    expect(resendBodySchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(
      resetBodySchema.safeParse({ token: 'A'.repeat(43), password: 'correct-horse' }).success,
    ).toBe(true);
    expect(resetBodySchema.safeParse({ token: 'A'.repeat(43), password: 'weak' }).success).toBe(
      false,
    );
  });

  it('validates invitation and tenant-selection requests without accepting extra authority fields', () => {
    expect(invitationPreviewBodySchema.safeParse({ token: 'A'.repeat(43) }).success).toBe(true);
    expect(
      invitationRegistrationBodySchema.safeParse({
        token: 'A'.repeat(43),
        password: 'correct-horse',
        fullName: 'Ada',
      }).success,
    ).toBe(true);
    expect(
      inviteMemberBodySchema.parse({ email: ' ADA@example.test ', roleKey: 'analyst' }),
    ).toEqual({
      email: 'ada@example.test',
      roleKey: 'analyst',
    });
    expect(
      inviteMemberBodySchema.safeParse({
        email: 'ada@example.test',
        roleKey: 'owner',
        tenantId: 'x',
      }).success,
    ).toBe(false);
    expect(
      tenantSelectionBodySchema.safeParse({ tenantId: '33333333-3333-4333-8333-333333333333' })
        .success,
    ).toBe(true);
    expect(
      tenantSelectionBodySchema.safeParse({
        tenantId: '33333333-3333-4333-8333-333333333333',
        role: 'owner',
      }).success,
    ).toBe(false);
  });

  it('validates tenant choices and the active tenant returned to the switcher', () => {
    expect(
      tenantChoicesResponseSchema.safeParse({
        activeTenantId: '33333333-3333-4333-8333-333333333333',
        tenants: [{ tenantId: '33333333-3333-4333-8333-333333333333', tenantName: 'CVC Capital' }],
      }).success,
    ).toBe(true);
    expect(
      tenantChoicesResponseSchema.safeParse({
        activeTenantId: '44444444-4444-4444-8444-444444444444',
        tenants: [{ tenantId: '33333333-3333-4333-8333-333333333333', tenantName: 'CVC Capital' }],
      }).success,
    ).toBe(true);
    expect(
      tenantChoicesResponseSchema.safeParse({
        activeTenantId: '44444444-4444-4444-8444-444444444444',
        tenants: [],
      }).success,
    ).toBe(true);
  });

  it('validates pending invitation data without accepting token fields', () => {
    const row = {
      invitationId: '44444444-4444-4444-8444-444444444444',
      email: 'new@example.test',
      roleKey: 'deal_member',
      createdAt: '2026-10-28T10:00:00+00:00',
      expiresAt: '2026-11-04T10:00:00+00:00',
    };
    expect(pendingInvitationsResponseSchema.safeParse({ invitations: [row] }).success).toBe(true);
    expect(
      pendingInvitationsResponseSchema.safeParse({ invitations: [{ ...row, tokenHash: 'secret' }] })
        .success,
    ).toBe(false);
    expect(
      pendingInvitationsResponseSchema.safeParse({ invitations: [{ ...row, email: 'bad' }] })
        .success,
    ).toBe(false);
  });

  it('validates onboarding input and applies the documented organisation defaults', () => {
    expect(profileBodySchema.safeParse({ displayName: 'Ada', jobTitle: null }).success).toBe(true);
    expect(profileBodySchema.safeParse({ displayName: '   ' }).error?.issues[0]?.message).toBe(
      'Enter a display name.',
    );
    expect(organisationBodySchema.parse({ name: 'CVC Capital' })).toEqual({
      name: 'CVC Capital',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
    });
    expect(
      defaultsBodySchema.safeParse({
        timezone: 'Africa/Johannesburg',
        currency: 'ZAR',
        closingSoonDays: 30,
      }).success,
    ).toBe(true);
    expect(
      defaultsBodySchema.safeParse({
        timezone: 'Africa/Johannesburg',
        currency: 'zar',
        closingSoonDays: 0,
      }).success,
    ).toBe(false);
  });
});
