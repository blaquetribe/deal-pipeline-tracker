import { serve } from '@hono/node-server';

import { createApp } from './app';
import { createGoTrue } from './auth/gotrue';
import { anonKey, apiServiceToken } from './auth/jwt';
import { createSessionResolver } from './auth/service';
import { createSessionStore } from './auth/session-store';
import { loadConfig } from './config';
import { createRpc } from './db/rpc';
import { createSmtpMailer } from './email/smtp';
import { createRateLimiter } from './http/rate-limit';

const config = loadConfig(process.env);
const publicKey = anonKey(config.JWT_SECRET);
const rpc = createRpc({ baseUrl: config.SUPABASE_URL, anonKey: publicKey });
const gotrue = createGoTrue({
  baseUrl: config.SUPABASE_URL,
  anonKey: publicKey,
  jwtSecret: config.JWT_SECRET,
});
const sessions = createSessionStore({
  rpc,
  jwtSecret: config.JWT_SECRET,
  sessionSecret: config.SESSION_SECRET,
});
const authRpc = {
  call: (name: string, args: Record<string, unknown>) =>
    rpc.call(name, args, apiServiceToken(config.JWT_SECRET)),
};
const userRpc = {
  call: (name: string, args: Record<string, unknown>, bearer: string) =>
    rpc.call(name, args, bearer),
};
const mailer = createSmtpMailer({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  from: config.MAIL_FROM,
  secure: config.SMTP_SECURE,
  requireTLS: config.SMTP_REQUIRE_TLS,
  ...(config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : {}),
});
const limiter = createRateLimiter();
const resolver = createSessionResolver({ sessions, gotrue, sessionSecret: config.SESSION_SECRET });
const auth = {
  rpc: authRpc,
  userRpc,
  gotrue,
  sessions,
  mailer,
  sessionSecret: config.SESSION_SECRET,
  appOrigin: config.APP_ORIGIN,
};
const logger = {
  info: (message: string, fields?: Record<string, unknown>) => console.info(message, fields),
  error: (message: string, fields?: Record<string, unknown>) => console.error(message, fields),
};

serve(
  {
    fetch: createApp({
      auth,
      http: {
        appOrigin: config.APP_ORIGIN,
        cookieSecure: config.cookieSecure,
        resolver,
        limiter,
        logger,
      },
    }).fetch,
    port: config.PORT,
  },
  (info) => {
    console.log(`api listening on :${info.port.toString()}`);
  },
);
