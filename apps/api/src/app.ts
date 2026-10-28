import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { mountAuthRoutes, type AuthServiceOptions } from './auth/service';
import { mountApprovalRoutes } from './features/approvals/routes';
import { mountDealRoutes } from './features/deals/routes';
import { createRateLimiter } from './http/rate-limit';
import type { HttpDeps } from './http/route';

export interface AppOptions {
  readonly auth: AuthServiceOptions;
  readonly http: Omit<HttpDeps, 'limiter'> & { readonly limiter?: HttpDeps['limiter'] };
}

export function createApp(options?: AppOptions): Hono {
  const app = new Hono();

  // API responses are JSON only: nothing may be framed, scripted or sniffed.
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
    }),
  );

  app.use(async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // Data-free liveness probe. Deliberately public (see docs/brief/GOTCHAS.md row 1).
  app.get('/health', (c) => c.json({ status: 'ok' }));

  if (options) {
    const httpDeps = { ...options.http, limiter: options.http.limiter ?? createRateLimiter() };
    mountAuthRoutes(app, httpDeps, options.auth);
    mountDealRoutes(app, httpDeps, { userRpc: options.auth.userRpc });
    mountApprovalRoutes(app, httpDeps, { userRpc: options.auth.userRpc });
  }

  return app;
}
