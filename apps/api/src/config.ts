import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type Config = z.infer<typeof configSchema>;

/** Parse and validate environment once at startup; fail fast on bad config. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  return configSchema.parse(env);
}
