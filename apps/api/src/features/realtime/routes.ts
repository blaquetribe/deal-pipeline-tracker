import { upgradeWebSocket } from '@hono/node-server';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { createRealtimeFeed, type RealtimeFeed } from '../../db/realtime';
import { cookieName, type HttpDeps, type Route, type Session } from '../../http/route';

declare module 'hono' {
  interface ContextVariableMap {
    realtimeSession: Session & { readonly tenantId: string };
  }
}

const SESSION_CHECK_MS = 30_000;
const CLOSE_SESSION_INVALID = 4001;
const CLOSE_UPSTREAM_ERROR = 1011;

export interface RealtimeRoutesOptions {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly http: Pick<HttpDeps, 'appOrigin' | 'cookieSecure' | 'resolver'>;
  readonly sessionCheckMs?: number;
}

export function createRealtimeRoutes(options: RealtimeRoutesOptions): Route[] {
  const route: Route = {
    method: 'GET',
    path: '/ws',
    access: 'session',
    permission: undefined,
    mount(app: Hono, deps: HttpDeps) {
      app.get(
        '/ws',
        async (context, next) => {
          if (context.req.header('origin') !== options.http.appOrigin) {
            return context.json(
              { error: { code: 'bad_origin', message: 'Origin is not allowed.' } },
              403,
            );
          }
          const forwardedFor = context.req.header('x-forwarded-for');
          const clientIp = forwardedFor?.split(',')[0]?.trim() || 'unknown';
          const rate = deps.limiter.hit(`websocket:${clientIp}`, { limit: 30, windowSeconds: 60 });
          if (!rate.allowed) {
            return context.json(
              { error: { code: 'rate_limited', message: 'Too many connections.' } },
              429,
            );
          }
          const opaqueId = getCookie(context, cookieName(options.http.cookieSecure));
          let session: Session | null;
          try {
            session = opaqueId ? await options.http.resolver.resolve(opaqueId) : null;
          } catch {
            return context.json(
              { error: { code: 'session_unavailable', message: 'Session unavailable.' } },
              503,
            );
          }
          const tenantId = session?.tenantId;
          if (!session || !tenantId) {
            return context.json(
              { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
              401,
            );
          }
          context.set('realtimeSession', { ...session, tenantId });
          return next();
        },
        upgradeWebSocket((context) => {
          const session = context.get('realtimeSession');
          let feed: RealtimeFeed | null = null;
          let timer: ReturnType<typeof setInterval> | undefined;
          let checking = false;
          let closed = false;
          let latestAccessToken = session.accessToken;

          const closeChannel = () => {
            closed = true;
            if (timer) clearInterval(timer);
            timer = undefined;
            feed?.close();
            feed = null;
          };

          return {
            onOpen(_event, socket) {
              void createRealtimeFeed({
                supabaseUrl: options.supabaseUrl,
                anonKey: options.anonKey,
                channelName: `notifications:${session.userId}:${session.tenantId}`,
                tenantId: session.tenantId,
                accessToken: latestAccessToken,
                onSubscribed: () => {
                  if (!closed) socket.send(JSON.stringify({ type: 'status', status: 'connected' }));
                },
                onNotification: (data) => {
                  if (!closed) socket.send(JSON.stringify({ type: 'notification', data }));
                },
                onDealsChanged: () => {
                  if (!closed) socket.send(JSON.stringify({ type: 'deals_changed' }));
                },
                onUnavailable: (status) => {
                  deps.logger.error('realtime_subscription_unavailable', { status });
                  socket.close(CLOSE_UPSTREAM_ERROR, 'Realtime unavailable');
                },
              })
                .then((createdFeed) => {
                  if (closed) {
                    createdFeed.close();
                    return;
                  }
                  feed = createdFeed;
                  if (latestAccessToken !== session.accessToken) {
                    createdFeed.updateAccessToken(latestAccessToken);
                  }
                })
                .catch(() => {
                  deps.logger.error('realtime_subscription_unavailable', {
                    status: 'CLIENT_INIT_ERROR',
                  });
                  socket.close(CLOSE_UPSTREAM_ERROR, 'Realtime unavailable');
                });

              timer = setInterval(() => {
                if (checking) return;
                checking = true;
                void options.http.resolver
                  .resolve(session.sessionId)
                  .then((current) => {
                    if (
                      !current ||
                      current.userId !== session.userId ||
                      current.tenantId !== session.tenantId
                    ) {
                      socket.close(CLOSE_SESSION_INVALID, 'Session changed');
                    } else {
                      latestAccessToken = current.accessToken;
                      feed?.updateAccessToken(latestAccessToken);
                    }
                  })
                  .catch(() => socket.close(CLOSE_SESSION_INVALID, 'Session unavailable'))
                  .finally(() => {
                    checking = false;
                  });
              }, options.sessionCheckMs ?? SESSION_CHECK_MS);
            },
            onClose: closeChannel,
            onError: closeChannel,
          };
        }),
      );
    },
  };

  return [route];
}

export function mountRealtimeRoutes(
  app: Hono,
  deps: HttpDeps,
  options: RealtimeRoutesOptions,
): Route[] {
  const routes = createRealtimeRoutes(options);
  for (const route of routes) route.mount(app, deps);
  return routes;
}
