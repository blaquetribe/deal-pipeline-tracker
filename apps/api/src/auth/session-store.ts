import { z } from 'zod';

import { RpcError, type Rpc } from '../db/rpc';
import { decryptSecret, deriveKey, encryptSecret, randomToken, sha256Hex } from './crypto';
import { apiServiceToken } from './jwt';

/** What the API keeps per session. It never reaches the browser (ADR 0002, ADR 0015). */
export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  readonly expiresAt: number;
  /** Kept with the tokens so the API can address and greet the user without another lookup. */
  readonly email: string;
  readonly fullName: string | null;
}

export interface SessionRecord {
  readonly userId: string;
  readonly tokens: StoredTokens;
  readonly activeTenantId: string | null;
}

interface SessionStoreOptions {
  readonly rpc: Rpc;
  readonly jwtSecret: string;
  readonly sessionSecret: string;
}

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

const storedTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  email: z.string(),
  fullName: z.string().nullable(),
});
const lookupRowsSchema = z.array(
  z.object({
    user_id: z.string(),
    tokens_enc: z.string(),
    active_tenant_id: z.string().nullable(),
  }),
);

const toBytea = (blob: Buffer): string => `\\x${blob.toString('hex')}`;
const fromBytea = (value: string): Buffer => Buffer.from(value.replace(/^\\x/, ''), 'hex');

function isDenied(error: unknown): boolean {
  return error instanceof RpcError && error.code === '42501';
}

export function createSessionStore({ rpc, jwtSecret, sessionSecret }: SessionStoreOptions) {
  const key = deriveKey(sessionSecret, 'session-tokens');
  const asService = (name: string, args: Record<string, unknown>): Promise<unknown> =>
    rpc.call(name, args, apiServiceToken(jwtSecret));
  const seal = (tokens: StoredTokens): string =>
    toBytea(encryptSecret(JSON.stringify(tokens), key));

  return {
    /** Returns the opaque id for the cookie. Only its hash and the sealed tokens are stored. */
    async create(userId: string, tokens: StoredTokens): Promise<{ sessionId: string }> {
      const sessionId = randomToken();
      await asService('session_create', {
        p_session_hash: sha256Hex(sessionId),
        p_user: userId,
        p_tokens_enc: seal(tokens),
      });
      return { sessionId };
    },

    /** Fails closed: anything unexpected about a stored session reads as signed out. */
    async lookup(sessionId: string): Promise<SessionRecord | null> {
      if (!SESSION_ID.test(sessionId)) {
        return null;
      }
      const rows = lookupRowsSchema.parse(
        await asService('session_lookup', { p_session_hash: sha256Hex(sessionId) }),
      );
      const row = rows[0];
      if (!row) {
        return null;
      }
      try {
        const tokens = storedTokensSchema.parse(
          JSON.parse(decryptSecret(fromBytea(row.tokens_enc), key)),
        );
        return { userId: row.user_id, tokens, activeTenantId: row.active_tenant_id };
      } catch {
        return null;
      }
    },

    /** False when the session is gone, expired or revoked. */
    async updateTokens(sessionId: string, tokens: StoredTokens): Promise<boolean> {
      try {
        await asService('session_update_tokens', {
          p_session_hash: sha256Hex(sessionId),
          p_tokens_enc: seal(tokens),
        });
        return true;
      } catch (error) {
        if (isDenied(error)) {
          return false;
        }
        throw error;
      }
    },

    /** False when the user is not an active member of that tenant (or the session is gone). */
    async setTenant(sessionId: string, tenantId: string): Promise<boolean> {
      try {
        await asService('session_set_tenant', {
          p_session_hash: sha256Hex(sessionId),
          p_tenant: tenantId,
        });
        return true;
      } catch (error) {
        if (isDenied(error)) {
          return false;
        }
        throw error;
      }
    },

    async revoke(sessionId: string): Promise<void> {
      await asService('session_revoke', { p_session_hash: sha256Hex(sessionId) });
    },

    async revokeUser(userId: string): Promise<number> {
      return z
        .number()
        .int()
        .parse(await asService('session_revoke_user', { p_user: userId }));
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
