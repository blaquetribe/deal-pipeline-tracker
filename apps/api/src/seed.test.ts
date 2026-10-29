import { describe, expect, it, vi } from 'vitest';

import type { GoTrue } from './auth/gotrue';
import type { Rpc } from './db/rpc';
import { DEMO_USERS, readSeedEnvironment, runDemoSeed } from './seed';

const JWT_SECRET = 'dev-only-jwt-secret-change-me-minimum-32-characters';

function claims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JWT payload must be an object');
  }
  return Object.fromEntries(Object.entries(value));
}

describe('development seed', () => {
  it('does nothing when the dev seed switch is off', async () => {
    expect(() => readSeedEnvironment({ SEED_DEV_DATA: 'false', JWT_SECRET })).not.toThrow();
    const ensureDemoUser = vi.fn<GoTrue['ensureDemoUser']>();
    const call = vi.fn<Rpc['call']>();
    await runDemoSeed({
      enabled: false,
      password: undefined,
      jwtSecret: JWT_SECRET,
      gotrue: { ensureDemoUser },
      rpc: { call },
    });
    expect(ensureDemoUser).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it('creates every fixed fictional user and seeds database roles and deals once', async () => {
    const ensureDemoUser = vi.fn<GoTrue['ensureDemoUser']>(async () => undefined);
    const call = vi.fn<Rpc['call']>(async () => ({ seeded: true }));
    await runDemoSeed({
      enabled: true,
      password: 'DptDemoPass-2026-local',
      jwtSecret: JWT_SECRET,
      gotrue: { ensureDemoUser },
      rpc: { call },
    });
    expect(ensureDemoUser).toHaveBeenCalledTimes(DEMO_USERS.length);
    expect(ensureDemoUser).toHaveBeenCalledWith({
      ...DEMO_USERS[0],
      password: 'DptDemoPass-2026-local',
    });
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[0]).toBe('seed_demo_data');
    expect(claims(call.mock.calls[0]?.[2] ?? '')).toMatchObject({ role: 'api_service' });
  });

  it('creates GoTrue users sequentially to avoid overwhelming the internal gateway', async () => {
    let active = 0;
    let maximumActive = 0;
    const ensureDemoUser = vi.fn<GoTrue['ensureDemoUser']>(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    });
    await runDemoSeed({
      enabled: true,
      password: 'DptDemoPass-2026-local',
      jwtSecret: JWT_SECRET,
      gotrue: { ensureDemoUser },
      rpc: { call: vi.fn<Rpc['call']>(async () => null) },
    });
    expect(maximumActive).toBe(1);
  });

  it('fails closed when a demo account cannot be ensured or the password is weak', async () => {
    const failingUser = vi.fn<GoTrue['ensureDemoUser']>(async () => {
      throw new Error('private upstream detail');
    });
    const call = vi.fn<Rpc['call']>();
    await expect(
      runDemoSeed({
        enabled: true,
        password: 'DptDemoPass-2026-local',
        jwtSecret: JWT_SECRET,
        gotrue: { ensureDemoUser: failingUser },
        rpc: { call },
      }),
    ).rejects.toThrow('private upstream detail');
    await expect(
      runDemoSeed({
        enabled: true,
        password: 'short',
        jwtSecret: JWT_SECRET,
        gotrue: { ensureDemoUser: vi.fn<GoTrue['ensureDemoUser']>() },
        rpc: { call },
      }),
    ).rejects.toThrow('at least 12 characters');
    expect(call).not.toHaveBeenCalled();
  });
});
