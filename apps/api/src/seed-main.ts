import { createGoTrue } from './auth/gotrue';
import { anonKey } from './auth/jwt';
import { createRpc } from './db/rpc';
import { readSeedEnvironment, runDemoSeed } from './seed';

async function main(): Promise<void> {
  const config = readSeedEnvironment(process.env);
  if (!config.enabled) {
    console.info('development seed disabled');
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error('development seed configuration is invalid');

  const gotrue = createGoTrue({
    baseUrl: supabaseUrl,
    anonKey: anonKey(config.jwtSecret),
    jwtSecret: config.jwtSecret,
  });
  const rpc = createRpc({ baseUrl: supabaseUrl, anonKey: anonKey(config.jwtSecret) });
  await runDemoSeed({ ...config, gotrue, rpc });
  console.info('development seed applied');
}

void main().catch((error: unknown) => {
  console.error('development seed failed', {
    error: error instanceof Error ? error.name : 'unknown',
  });
  process.exitCode = 1;
});
