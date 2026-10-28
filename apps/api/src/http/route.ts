import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { safeEqual } from '../auth/crypto';
import { HttpError, toHttpError } from './errors';
import type { RateLimiter, RateRule } from './rate-limit';

/**
 * Every route is declared through publicRoute or sessionRoute. A route that is not declared cannot be
 * mounted, so authentication is opt-out and visible: a public route is a decision written in code, and
 * the sweep test lists them all (GOTCHAS 1, SECURITY_STANDARDS "Route gating").
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const SAFE_METHODS: ReadonlySet<Method> = new Set(['GET']);

export interface Session {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string | null;
  /** Server-side only: database calls that must run with the user's RLS identity use this token. */
  readonly accessToken: string;
  /** Bound to this session; sent back by the web app in X-CSRF-Token on unsafe requests. */
  readonly csrfToken: string;
}

export interface SessionResolver {
  resolve(sessionId: string): Promise<Session | null>;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface HttpDeps {
  readonly appOrigin: string;
  readonly cookieSecure: boolean;
  readonly resolver: SessionResolver;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
}

/** For routes that take no body. */
export const noBody = z.undefined();
const isNoBody = (schema: z.ZodType): boolean => schema === noBody;

interface BaseContext<B> {
  readonly body: B;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly requestId: string;
  readonly clientIp: string;
  /** Opens (or replaces) the session cookie. The id is opaque; only its hash is stored (ADR 0015). */
  setSessionCookie(sessionId: string): void;
  clearSessionCookie(): void;
}

export type PublicContext<B> = BaseContext<B>;
export interface SessionContext<B> extends BaseContext<B> {
  readonly session: Session;
}

export interface Reply {
  readonly status?: ContentfulStatusCode | 204;
  readonly body?: unknown;
}

interface RateLimitRule<B> extends RateRule {
  /** Counted separately per key; typically the client IP and, once known, the account. */
  keys(ctx: { clientIp: string; body: B }): readonly string[];
  name: string;
}

interface BaseDef<B> {
  readonly method: Method;
  readonly path: string;
  readonly body: z.ZodType<B>;
  readonly rateLimit?: RateLimitRule<B>;
}

export interface PublicRouteDef<B> extends BaseDef<B> {
  handler(ctx: PublicContext<B>): Promise<Reply>;
}

export interface SessionRouteDef<B> extends BaseDef<B> {
  /** The permission the database will enforce; declared so the sweep and reviewers can see it. */
  readonly permission?: string;
  handler(ctx: SessionContext<B>): Promise<Reply>;
}

export interface Route {
  readonly method: Method;
  readonly path: string;
  readonly access: 'public' | 'session';
  readonly permission: string | undefined;
  mount(app: Hono, deps: HttpDeps): void;
}

const MAX_BODY_BYTES = 64 * 1024;

export function cookieName(secure: boolean): string {
  // The __Host- prefix makes the browser refuse a cookie set from a sibling subdomain; it needs Secure.
  return secure ? '__Host-dpt_session' : 'dpt_session';
}

function clientIpOf(c: Context): string {
  // Only the gateway can reach this service, and Caddy overwrites X-Forwarded-For with the real peer.
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

function originOk(c: Context, appOrigin: string): boolean {
  const origin = c.req.header('origin');
  if (origin) {
    return origin === appOrigin;
  }
  const referer = c.req.header('referer');
  if (referer) {
    try {
      return new URL(referer).origin === appOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

function fail(c: Context, error: HttpError, extra?: Record<string, string>): Response {
  for (const [name, value] of Object.entries(extra ?? {})) {
    c.header(name, value);
  }
  return c.json({ error: { code: error.code, message: error.message } }, error.status);
}

function mountRoute<B>(
  app: Hono,
  deps: HttpDeps,
  def: BaseDef<B>,
  requireSession: boolean,
  run: (ctx: BaseContext<B>, session: Session | null) => Promise<Reply>,
): void {
  const unsafe = !SAFE_METHODS.has(def.method);
  const cookie = cookieName(deps.cookieSecure);
  const hasBody = !isNoBody(def.body);

  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => fail(c, new HttpError(413, 'payload_too_large', 'The request is too large.')),
  });

  app.on(def.method, def.path, limit, async (c) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.header('X-Request-Id', requestId);
    const clientIp = clientIpOf(c);

    try {
      if (unsafe && !originOk(c, deps.appOrigin)) {
        return fail(
          c,
          new HttpError(403, 'bad_origin', 'This request did not come from the application.'),
        );
      }

      const sessionId = getCookie(c, cookie);
      const session = sessionId ? await deps.resolver.resolve(sessionId) : null;
      if (requireSession && !session) {
        return fail(c, new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
      }
      if (
        requireSession &&
        unsafe &&
        !safeEqual(c.req.header('x-csrf-token') ?? '', session?.csrfToken ?? '')
      ) {
        return fail(
          c,
          new HttpError(
            403,
            'bad_csrf',
            'The request could not be verified. Reload and try again.',
          ),
        );
      }

      let body: B;
      if (hasBody) {
        if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
          return fail(c, new HttpError(415, 'unsupported_media_type', 'Send application/json.'));
        }
        const parsed = def.body.safeParse(await c.req.json().catch(() => undefined));
        if (!parsed.success) {
          const fields = [
            ...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)')),
          ];
          return c.json(
            {
              error: { code: 'invalid_request', message: 'Check the highlighted fields.', fields },
            },
            400,
          );
        }
        body = parsed.data;
      } else {
        body = def.body.parse(undefined);
      }

      if (def.rateLimit) {
        for (const key of def.rateLimit.keys({ clientIp, body })) {
          const decision = deps.limiter.hit(`${def.rateLimit.name}:${key}`, def.rateLimit);
          if (!decision.allowed) {
            return fail(
              c,
              new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.'),
              {
                'Retry-After': String(decision.retryAfterSeconds),
              },
            );
          }
        }
      }

      const reply = await run(
        {
          body,
          params: c.req.param(),
          query: new URL(c.req.url).searchParams,
          requestId,
          clientIp,
          setSessionCookie: (id) =>
            setCookie(c, cookie, id, {
              httpOnly: true,
              secure: deps.cookieSecure,
              sameSite: 'Lax',
              path: '/',
              maxAge: 12 * 60 * 60,
            }),
          clearSessionCookie: () =>
            deleteCookie(c, cookie, { path: '/', secure: deps.cookieSecure }),
        },
        session,
      );
      if (reply.status === 204 || reply.body === undefined) {
        return c.body(null, reply.status ?? 204);
      }
      return c.json(reply.body, reply.status ?? 200);
    } catch (error) {
      const mapped = toHttpError(error);
      if (mapped.status >= 500) {
        deps.logger.error('request failed', {
          requestId,
          method: def.method,
          path: def.path,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      return fail(c, mapped);
    }
  });
}

/** A route anyone may call. Say why in the PR: each one widens the signed-out surface. */
export function publicRoute<B = undefined>(def: PublicRouteDef<B>): Route {
  return {
    method: def.method,
    path: def.path,
    access: 'public',
    permission: undefined,
    mount: (app, deps) => {
      mountRoute(app, deps, def, false, (ctx) => def.handler(ctx));
    },
  };
}

/** A route that needs a signed-in session (and, for unsafe methods, the CSRF token). */
export function sessionRoute<B = undefined>(def: SessionRouteDef<B>): Route {
  return {
    method: def.method,
    path: def.path,
    access: 'session',
    permission: def.permission,
    mount: (app, deps) => {
      mountRoute(app, deps, def, true, (ctx, session) => {
        if (!session) {
          throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
        }
        return def.handler({ ...ctx, session });
      });
    },
  };
}

export function describeRoutes(
  routes: readonly Route[],
): { method: Method; path: string; access: 'public' | 'session' }[] {
  return routes.map(({ method, path, access }) => ({ method, path, access }));
}
