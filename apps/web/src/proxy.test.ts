import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy';

describe('web proxy', () => {
  it('redirects protected routes without a session and applies the CSP header', () => {
    const response = proxy(new NextRequest('http://localhost/deals'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('forwards a nonce and CSP for an authenticated request', () => {
    const request = new NextRequest('http://localhost/deals');
    request.cookies.set('dpt_session', 'opaque-session-id');
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toMatch(
      /script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/,
    );
  });

  it('supports the host-prefixed session cookie and allows a public sign-in route', () => {
    const protectedRequest = new NextRequest('http://localhost/onboarding/profile');
    protectedRequest.cookies.set('__Host-dpt_session', 'opaque-session-id');
    expect(proxy(protectedRequest).status).toBe(200);
    expect(proxy(new NextRequest('http://localhost/login')).status).toBe(200);
  });
});
