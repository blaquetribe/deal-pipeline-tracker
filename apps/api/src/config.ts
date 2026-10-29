import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');

const configSchema = z
  .object({
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
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_REQUIRE_TLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    MAIL_FROM: z.email().default('no-reply@dpt.local'),
    OBJECT_STORE_DRIVER: z.enum(['fs', 's3']).default('fs'),
    DEPLOYMENT_ENV: z.enum(['development', 'production']).default('development'),
    STORAGE_DIRECTORY: z.string().min(1).default('/var/lib/dpt/files'),
    STORAGE_ENDPOINT: z.url().default('http://rustfs:9000'),
    STORAGE_REGION: z.string().min(1).default('auto'),
    STORAGE_BUCKET: z.string().min(1).default('deal-pipeline-tracker'),
    STORAGE_KEY_PREFIX: z.enum(['Dev/', 'Prod/']).default('Dev/'),
    STORAGE_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    STORAGE_ACCESS_KEY_ID: z.string().default(''),
    STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
  })
  .superRefine((config, context) => {
    if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASS)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP_USER and SMTP_PASS must be configured together',
      });
    }
    if (config.SMTP_USER && !config.SMTP_SECURE && !config.SMTP_REQUIRE_TLS) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP authentication requires TLS',
      });
    }
    const production = config.DEPLOYMENT_ENV === 'production';
    if (
      (production && config.STORAGE_KEY_PREFIX !== 'Prod/') ||
      (!production && config.STORAGE_KEY_PREFIX !== 'Dev/')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_KEY_PREFIX'],
        message: 'must match NODE_ENV',
      });
    }
    if (
      config.OBJECT_STORE_DRIVER === 's3' &&
      (!config.STORAGE_ACCESS_KEY_ID || !config.STORAGE_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_ACCESS_KEY_ID'],
        message: 'S3 credentials are required when OBJECT_STORE_DRIVER=s3',
      });
    }
  });

export type Config = z.infer<typeof configSchema> & { readonly cookieSecure: boolean };

/** Parse and validate environment once at startup; fail fast on bad config. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = configSchema.parse(env);
  return { ...parsed, cookieSecure: parsed.APP_ORIGIN.startsWith('https://') };
}
