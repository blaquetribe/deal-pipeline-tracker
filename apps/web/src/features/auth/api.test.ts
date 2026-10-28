import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, authRequest, sessionRead, sessionRequest } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('auth API client', () => {
  it('sends same-origin JSON requests and returns JSON or undefined for no-content', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    await expect(authRequest('/auth/login', { email: 'a@example.test' })).resolves.toEqual({
      accepted: true,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.test' }),
      }),
    );
    await expect(authRequest('/auth/logout', {})).resolves.toBeUndefined();
  });

  it('maps structured and malformed error responses to safe API client errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'denied', message: 'Not allowed.' } }), {
          status: 403,
        }),
      )
      .mockResolvedValueOnce(new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetch);

    await expect(authRequest('/auth/login', {})).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'denied',
      message: 'Not allowed.',
    });
    await expect(sessionRead('/auth/tenants')).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'request_failed',
      message: 'The request could not be completed. Try again.',
    });
    expect(new ApiClientError('x', 'y')).toBeInstanceOf(Error);
  });

  it('requires a valid session and CSRF token before an unsafe session request', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'bad' } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(sessionRequest('/auth/logout', 'POST')).rejects.toThrow(
      'Your session has ended. Sign in again to continue.',
    );
    await expect(sessionRequest('/auth/logout', 'POST')).rejects.toThrow('user');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('adds the CSRF token, supports omitted bodies, and handles no-content mutation responses', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              email: 'a@example.test',
              fullName: null,
            },
            tenantId: null,
            csrfToken: 'csrf-token',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              email: 'a@example.test',
              fullName: null,
            },
            tenantId: null,
            csrfToken: 'csrf-token',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tenantId: '22222222-2222-4222-8222-222222222222' }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(sessionRequest('/auth/logout', 'POST')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token' },
      }),
    );
    await expect(
      sessionRequest('/auth/tenant', 'PUT', { tenantId: '22222222-2222-4222-8222-222222222222' }),
    ).resolves.toEqual({ tenantId: '22222222-2222-4222-8222-222222222222' });
  });
});
