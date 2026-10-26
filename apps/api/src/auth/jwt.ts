import { createHmac } from 'node:crypto';

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

/** The token PostgREST turns into the `api_service` role (ADR 0015). Short-lived, minted per use. */
export function apiServiceToken(secret: string, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  return signJwt({ role: 'api_service', iat, exp: iat + 60 }, secret);
}

/**
 * The public anon key. The internal gateway compares it byte for byte, so the claims are FIXED and
 * must equal scripts/supabase-keys.mjs (a test cross-checks them).
 */
export function anonKey(secret: string): string {
  return signJwt({ role: 'anon', iss: 'supabase', iat: 1_700_000_000, exp: 4_102_444_800 }, secret);
}
