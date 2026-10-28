import { z } from 'zod';

import { signJwt } from './jwt';
import type { StoredTokens } from './session-store';

/**
 * The only module that talks to GoTrue, and the only place the admin token exists (ADR 0016). The token
 * is minted per call, lives 30 seconds, is never exported, and a test fails if the role name appears
 * anywhere else in the source.
 */

type Kind = 'unavailable' | 'weak_password' | 'rejected';

export class GoTrueError extends Error {
  constructor(
    readonly kind: Kind,
    message: string,
  ) {
    super(message);
    this.name = 'GoTrueError';
  }
}

export interface Authenticated {
  readonly userId: string;
  readonly tokens: StoredTokens;
}

export interface GoTrue {
  /** Null for every kind of failed sign-in: wrong password, unknown user, unverified email. */
  passwordLogin(email: string, password: string): Promise<Authenticated | null>;
  /** Null when GoTrue no longer accepts the refresh token. */
  refresh(refreshToken: string): Promise<Authenticated | null>;
  /** Best effort: the local session is revoked whatever GoTrue answers. */
  logout(accessToken: string): Promise<void>;
  /** The user is created unconfirmed; the database confirms the email when the token is consumed. */
  createUser(input: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<{ userId: string } | 'exists'>;
  setPassword(userId: string, password: string): Promise<void>;
}

interface GoTrueOptions {
  readonly baseUrl: string;
  readonly anonKey: string;
  readonly jwtSecret: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  expires_at: z.number().optional(),
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    user_metadata: z.object({ full_name: z.string().optional() }).loose().optional(),
  }),
});
const errorSchema = z.object({ error_code: z.string().optional() }).loose();
const createdSchema = z.object({ id: z.uuid() }).loose();

const FAILED_SIGN_IN = new Set(['invalid_credentials', 'email_not_confirmed']);
const DEAD_REFRESH = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'bad_jwt',
]);
const ALREADY_REGISTERED = new Set(['email_exists', 'user_already_exists']);

function codeOf(json: unknown): string | undefined {
  const parsed = errorSchema.safeParse(json);
  return parsed.success ? parsed.data.error_code : undefined;
}

export function createGoTrue({
  baseUrl,
  anonKey,
  jwtSecret,
  fetchFn = fetch,
  now = Date.now,
}: GoTrueOptions): GoTrue {
  /** A 30 second token for GoTrue's admin API. Private on purpose. */
  function adminToken(): string {
    const iat = Math.floor(now() / 1000);
    return signJwt({ role: 'service_role', iat, exp: iat + 30 }, jwtSecret);
  }

  async function send(
    method: string,
    path: string,
    bearer: string | undefined,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/auth/v1${path}`, {
        method,
        headers: {
          apikey: anonKey,
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new GoTrueError('unavailable', 'the sign-in service is unavailable');
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  }

  function authenticated(json: unknown): Authenticated {
    const parsed = tokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new GoTrueError('unavailable', 'the sign-in service gave an unreadable answer');
    }
    const { access_token, refresh_token, expires_in, expires_at, user } = parsed.data;
    return {
      userId: user.id,
      tokens: {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expires_at === undefined ? now() + expires_in * 1000 : expires_at * 1000,
        email: user.email,
        fullName: user.user_metadata?.full_name ?? null,
      },
    };
  }

  return {
    async passwordLogin(email, password) {
      const { status, json } = await send('POST', '/token?grant_type=password', undefined, {
        email,
        password,
      });
      if (status === 200) {
        return authenticated(json);
      }
      if (status === 400 && FAILED_SIGN_IN.has(codeOf(json) ?? '')) {
        return null;
      }
      throw new GoTrueError('unavailable', 'the sign-in service failed');
    },

    async refresh(refreshToken) {
      const { status, json } = await send('POST', '/token?grant_type=refresh_token', undefined, {
        refresh_token: refreshToken,
      });
      if (status === 200) {
        return authenticated(json);
      }
      if ((status === 400 || status === 401) && DEAD_REFRESH.has(codeOf(json) ?? '')) {
        return null;
      }
      throw new GoTrueError('unavailable', 'the sign-in service failed');
    },

    async logout(accessToken) {
      try {
        await send('POST', '/logout', accessToken);
      } catch {
        // The session is revoked locally either way.
      }
    },

    async createUser({ email, password, fullName }) {
      const { status, json } = await send('POST', '/admin/users', adminToken(), {
        email,
        password,
        email_confirm: false,
        user_metadata: { full_name: fullName },
      });
      if (status === 200) {
        const parsed = createdSchema.safeParse(json);
        if (parsed.success) {
          return { userId: parsed.data.id };
        }
        throw new GoTrueError('unavailable', 'the sign-in service gave an unreadable answer');
      }
      const code = codeOf(json) ?? '';
      if (status === 422 && ALREADY_REGISTERED.has(code)) {
        return 'exists';
      }
      if (status === 422 && code === 'weak_password') {
        throw new GoTrueError('weak_password', 'the password was not accepted');
      }
      throw new GoTrueError('unavailable', 'the sign-in service failed');
    },

    async setPassword(userId, password) {
      if (!z.uuid().safeParse(userId).success) {
        throw new GoTrueError('rejected', 'invalid user id');
      }
      const { status } = await send('PUT', `/admin/users/${userId}`, adminToken(), { password });
      if (status !== 200) {
        throw new GoTrueError(
          status >= 500 ? 'unavailable' : 'rejected',
          'the password was not changed',
        );
      }
    },
  };
}
