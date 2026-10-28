import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { anonKey, apiServiceToken, signJwt } from './jwt';

const secret = 'dev-only-jwt-secret-change-me-minimum-32-characters';

const claimsSchema = z.record(z.string(), z.unknown());

function decode(token: string): {
  header: unknown;
  claims: Record<string, unknown>;
  signature: string;
} {
  const [header = '', payload = '', signature = ''] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    claims: claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))),
    signature,
  };
}

describe('signJwt', () => {
  it('signs HS256 over header.payload', () => {
    const token = signJwt({ role: 'x' }, secret);
    const { header, claims, signature } = decode(token);
    const [h, p] = token.split('.');
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(claims).toEqual({ role: 'x' });
    expect(signature).toBe(createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'));
  });
});

describe('apiServiceToken', () => {
  it('carries the api_service role and a 60 second life', () => {
    const { claims } = decode(apiServiceToken(secret, 1_000_000));
    expect(claims).toEqual({ role: 'api_service', iat: 1000, exp: 1060 });
  });
});

describe('anonKey', () => {
  it('uses the fixed claims the internal gateway compares byte for byte (ADR 0014)', () => {
    expect(decode(anonKey(secret)).claims).toEqual({
      role: 'anon',
      iss: 'supabase',
      iat: 1_700_000_000,
      exp: 4_102_444_800,
    });
  });

  it('equals the key the repository script derives', async () => {
    // @ts-expect-error scripts/ is plain JavaScript without type declarations
    const script: unknown = await import('../../../../scripts/supabase-keys.mjs');
    const { signSupabaseKey } = z
      .object({
        signSupabaseKey: z.custom<(role: string, secret: string) => string>(
          (v) => typeof v === 'function',
        ),
      })
      .parse(script);
    expect(anonKey(secret)).toBe(signSupabaseKey('anon', secret));
  });
});
