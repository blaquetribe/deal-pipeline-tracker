import { tmpdir } from 'node:os';

import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';

import { createApp } from './app';
import { createGoTrue } from './auth/gotrue';
import { anonKey, apiServiceToken } from './auth/jwt';
import { createSessionResolver } from './auth/service';
import { createSessionStore } from './auth/session-store';
import { loadConfig } from './config';
import { createRpc } from './db/rpc';
import { createClosingSoonEmailWorker } from './email/closing-soon-worker';
import { createSmtpMailer } from './email/smtp';
import { createRateLimiter } from './http/rate-limit';
import { createFileCleanupWorker } from './storage/cleanup-worker';
import { createObjectStore } from './storage/object-store';

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
const logger = {
  info: (message: string, fields?: Record<string, unknown>) => console.info(message, fields),
  error: (message: string, fields?: Record<string, unknown>) => console.error(message, fields),
};
const objectStore = createObjectStore({
  driver: config.OBJECT_STORE_DRIVER,
  directory: config.STORAGE_DIRECTORY,
  endpoint: config.STORAGE_ENDPOINT,
  region: config.STORAGE_REGION,
  bucket: config.STORAGE_BUCKET,
  prefix: config.STORAGE_KEY_PREFIX,
  forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
  accessKeyId: config.STORAGE_ACCESS_KEY_ID,
  secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
});
const fileCleanupWorker = createFileCleanupWorker({
  rpc: authRpc,
  store: objectStore,
  keyPrefix: config.STORAGE_KEY_PREFIX,
  logger,
});
void fileCleanupWorker.run();
const fileCleanupTimer = setInterval(() => void fileCleanupWorker.run(), 6 * 60 * 60 * 1000);
fileCleanupTimer.unref();
const auth = {
  rpc: authRpc,
  userRpc,
  gotrue,
  sessions,
  mailer,
  sessionSecret: config.SESSION_SECRET,
  appOrigin: config.APP_ORIGIN,
};
type WebSocketAdapter = NonNullable<Parameters<typeof serve>[0]['websocket']>['server'];

const http = {
  appOrigin: config.APP_ORIGIN,
  cookieSecure: config.cookieSecure,
  resolver,
  limiter,
  logger,
};
const app = createApp({
  auth,
  http,
  realtime: { supabaseUrl: config.SUPABASE_URL, anonKey: publicKey, http },
  files: {
    userRpc,
    store: objectStore,
    keyPrefix: config.STORAGE_KEY_PREFIX,
    tempDirectory: tmpdir(),
  },
});
const closingSoonEmailWorker = createClosingSoonEmailWorker({
  rpc: authRpc,
  mailer,
  appOrigin: config.APP_ORIGIN,
  logger,
});
void closingSoonEmailWorker.run();
const closingSoonEmailTimer = setInterval(() => void closingSoonEmailWorker.run(), 60_000);
closingSoonEmailTimer.unref();
const websocketServer = new WebSocketServer({ noServer: true });
// ws and Hono expose compatible runtime adapters but their send callback overloads differ.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const honoWebsocketServer = websocketServer as unknown as WebSocketAdapter;

serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    websocket: { server: honoWebsocketServer },
  },
  (info) => {
    console.log(`api listening on :${info.port.toString()}`);
  },
);
