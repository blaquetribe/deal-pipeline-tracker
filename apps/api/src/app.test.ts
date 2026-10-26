import { describe, expect, it } from 'vitest';

import { createApp } from './app';

describe('api app', () => {
  const app = createApp();

  it('serves a data-free health response', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('locks down browser behaviour on API responses', async () => {
    const res = await app.request('/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await app.request('/does-not-exist');
    expect(res.status).toBe(404);
  });
});
