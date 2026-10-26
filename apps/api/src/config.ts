import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** The internal Supabase gateway. Reachable only on the internal network (ADR 0014). */
  SUPABASE_URL: z.url(),
  /** Signs the api_service JWT and the short-lived GoTrue admin JWT (ADR 0015, ADR 0016). */
  JWT_SECRET: secret,
  /** Seals stored session tokens and derives the CSRF key. */
  SESSION_SECRET: secret,
  /** The one public origin of the app. Checked on every unsafe request; decides the cookie flags. */
  APP_ORIGIN: z
    .url()
    .default('http://localhost:8080')
    .transform((value) => new URL(value).origin),
  SMTP_HOST: z.string().min(1).default('mailpit'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.email().default('no-reply@dpt.local'),
});

export type Config = z.infer<typeof configSchema> & { readonly cookieSecure: boolean };

/** Parse and validate environment once at startup; fail fast on bad config. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = configSchema.parse(env);
  return { ...parsed, cookieSecure: parsed.APP_ORIGIN.startsWith('https://') };
}
