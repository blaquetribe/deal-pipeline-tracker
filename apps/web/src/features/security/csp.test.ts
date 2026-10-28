import { describe, expect, it } from 'vitest';

import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('allows only same-origin resources and the configured websocket origin', () => {
    const policy = buildCsp('random-nonce', 'https://deals.example.test', false);
    expect(policy).toContain("script-src 'self' 'nonce-random-nonce' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-random-nonce'");
    expect(policy).toContain("connect-src 'self' wss://deals.example.test");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('allows unsafe-eval only in development and rejects non-http app origins', () => {
    expect(buildCsp('n', 'http://localhost:8080', true)).toContain("'unsafe-eval'");
    expect(buildCsp('n', 'http://localhost:8080', false)).not.toContain("'unsafe-eval'");
    expect(() => buildCsp('n', 'javascript:alert(1)', false)).toThrow(/HTTP or HTTPS/);
  });
});
