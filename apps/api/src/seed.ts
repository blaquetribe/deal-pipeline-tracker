import { z } from 'zod';

import type { GoTrue } from './auth/gotrue';
import { apiServiceToken } from './auth/jwt';
import type { Rpc } from './db/rpc';

export const DEMO_USERS = [
  {
    userId: 'd0000000-0000-4000-8000-000000000001',
    email: 'owner@asteron.example.test',
    fullName: 'Amara Ndlovu',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000002',
    email: 'admin@asteron.example.test',
    fullName: 'Thabo Maseko',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000003',
    email: 'lead@asteron.example.test',
    fullName: 'Lerato Molefe',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000004',
    email: 'member@asteron.example.test',
    fullName: 'Sibusiso Dlamini',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000005',
    email: 'ic@asteron.example.test',
    fullName: 'Naledi Khumalo',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000006',
    email: 'observer@asteron.example.test',
    fullName: 'Mandla Zulu',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000007',
    email: 'owner@imbali.example.test',
    fullName: 'Zanele Mbeki',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000008',
    email: 'admin@imbali.example.test',
    fullName: 'Pieter Jacobs',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000009',
    email: 'lead@imbali.example.test',
    fullName: 'Ayanda Nkosi',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000010',
    email: 'member@imbali.example.test',
    fullName: 'Nandi Botha',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000011',
    email: 'ic@imbali.example.test',
    fullName: 'Karabo Dube',
  },
  {
    userId: 'd0000000-0000-4000-8000-000000000012',
    email: 'observer@imbali.example.test',
    fullName: 'Mpho van der Merwe',
  },
] as const;

const seedEnvSchema = z.object({
  SEED_DEV_DATA: z.enum(['true', 'false']).default('true'),
  SEED_DEMO_PASSWORD: z.string().min(12).optional(),
  JWT_SECRET: z.string().min(32),
});

export async function runDemoSeed(options: {
  readonly enabled: boolean;
  readonly password: string | undefined;
  readonly jwtSecret: string;
  readonly gotrue: Pick<GoTrue, 'ensureDemoUser'>;
  readonly rpc: Rpc;
}): Promise<void> {
  if (!options.enabled) return;
  if (!options.password || options.password.length < 12) {
    throw new Error('development seed password must be at least 12 characters');
  }
  const password = options.password;

  await DEMO_USERS.reduce<Promise<void>>(
    (pending, user) => pending.then(() => options.gotrue.ensureDemoUser({ ...user, password })),
    Promise.resolve(),
  );
  await options.rpc.call('seed_demo_data', {}, apiServiceToken(options.jwtSecret));
}

export function readSeedEnvironment(env: Record<string, string | undefined>) {
  const parsed = seedEnvSchema.safeParse(env);
  if (!parsed.success) throw new Error('development seed configuration is invalid');
  return {
    enabled: parsed.data.SEED_DEV_DATA === 'true',
    password: parsed.data.SEED_DEMO_PASSWORD,
    jwtSecret: parsed.data.JWT_SECRET,
  };
}
