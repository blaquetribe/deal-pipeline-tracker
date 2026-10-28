import { describe, expect, it } from 'vitest';

import { createRpc, RpcError } from './rpc';

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function fakeFetch(respond: (url: string, init: RequestInit) => Response): typeof fetch {
  return (input, init) => Promise.resolve(respond(urlOf(input), init ?? {}));
}

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to fail');
}

const base = { baseUrl: 'http://gw:8000', anonKey: 'anon-key' };

describe('createRpc', () => {
  it('posts JSON to the RPC route with the api key and the bearer token', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const rpc = createRpc({
      ...base,
      fetchFn: fakeFetch((url, init) => {
        seen = { url, init };
        return new Response('"abc"', { status: 200 });
      }),
    });
    await expect(rpc.call('session_lookup', { p_session_hash: 'h' }, 'bearer-token')).resolves.toBe(
      'abc',
    );
    expect(seen?.url).toBe('http://gw:8000/rest/v1/rpc/session_lookup');
    expect(seen?.init.method).toBe('POST');
    expect(seen?.init.body).toBe('{"p_session_hash":"h"}');
    expect(seen?.init.headers).toMatchObject({
      apikey: 'anon-key',
      Authorization: 'Bearer bearer-token',
      'Content-Type': 'application/json',
    });
  });

  it('returns undefined for 204', async () => {
    const rpc = createRpc({
      ...base,
      fetchFn: fakeFetch(() => new Response(null, { status: 204 })),
    });
    await expect(rpc.call('x', {}, 't')).resolves.toBeUndefined();
  });

  it('maps a PostgREST error to RpcError with the SQLSTATE and message', async () => {
    const rpc = createRpc({
      ...base,
      fetchFn: fakeFetch(
        () =>
          new Response(
            JSON.stringify({ code: 'DP401', message: 'invalid token', details: null, hint: null }),
            { status: 400 },
          ),
      ),
    });
    const error = await failure(rpc.call('token_consume', {}, 't'));
    expect(error).toMatchObject({ code: 'DP401', message: 'invalid token', status: 400 });
  });

  it('does not leak a non-JSON error body', async () => {
    const rpc = createRpc({
      ...base,
      fetchFn: fakeFetch(() => new Response('<html>secret stack</html>', { status: 502 })),
    });
    const error = await failure(rpc.call('x', {}, 't'));
    expect(error).toMatchObject({ code: 'upstream', status: 502 });
    expect(error.message).not.toContain('secret');
  });

  it('reports an unreachable database without leaking the cause', async () => {
    const rpc = createRpc({
      ...base,
      fetchFn: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.9:8000')),
    });
    const error = await failure(rpc.call('x', {}, 't'));
    expect(error).toMatchObject({ code: 'unavailable', status: 503 });
    expect(error.message).not.toContain('10.0.0.9');
  });

  it('refuses a function name that is not a plain identifier', async () => {
    const rpc = createRpc({ ...base, fetchFn: fakeFetch(() => new Response('{}')) });
    await expect(rpc.call('../auth/v1/admin', {}, 't')).rejects.toThrow(/invalid rpc name/);
  });
});
