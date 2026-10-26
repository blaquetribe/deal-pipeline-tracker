import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

export function createApp(): Hono {
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

  return app;
}
