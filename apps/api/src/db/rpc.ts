import { z } from 'zod';

/** A thin PostgREST RPC client. Every database write goes through a function (ADR 0002). */

export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface Rpc {
  /** The response is untrusted until the caller validates it. */
  call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
}

interface RpcOptions {
  readonly baseUrl: string;
  readonly anonKey: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const errorBodySchema = z.object({ code: z.string(), message: z.string() });

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createRpc({
  baseUrl,
  anonKey,
  fetchFn = fetch,
  timeoutMs = 5000,
}: RpcOptions): Rpc {
  return {
    async call(name, args, bearer) {
      if (!IDENTIFIER.test(name)) {
        throw new Error('invalid rpc name');
      }

      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new RpcError('unavailable', 'database unavailable', 503);
      }

      const text = await response.text();
      if (response.ok) {
        return text === '' ? undefined : JSON.parse(text);
      }
      const body = errorBodySchema.safeParse(safeJson(text));
      if (body.success) {
        throw new RpcError(body.data.code, body.data.message, response.status);
      }
      throw new RpcError('upstream', 'unexpected database response', response.status);
    },
  };
}
