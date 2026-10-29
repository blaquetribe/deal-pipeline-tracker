import { describe, expect, it } from 'vitest';

import { requiresSessionCookie } from './route-policy';

describe('requiresSessionCookie', () => {
  it.each([
    '/login',
    '/signup',
    '/check-email',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/accept-invitation',
  ])('allows the public page %s', (path) => {
    expect(requiresSessionCookie(path)).toBe(false);
  });

  it.each([
    '/',
    '/onboarding',
    '/onboarding/profile',
    '/onboarding/organisation',
    '/onboarding/defaults',
    '/onboarding/invite',
    '/roles',
    '/unknown',
  ])('protects the page %s by default', (path) => {
    expect(requiresSessionCookie(path)).toBe(true);
  });
});
