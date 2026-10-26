// Derives the Supabase API keys (anon, service_role) from JWT_SECRET (ADR 0014).
//
// The internal gateway (supabase/gateway/docker-entrypoint.sh) derives the same keys with
// openssl, and Envoy compares the apikey header by exact string equality, so the claims are
// FIXED (no moving iat or exp). Anything that talks to the gateway must produce identical
// strings; scripts/supabase-keys.test.mjs checks this implementation against the shell one.
import { createHmac } from 'node:crypto';

const encode = (text) => Buffer.from(text).toString('base64url');

/**
 * @param {'anon' | 'service_role'} role
 * @param {string} secret the JWT secret shared by GoTrue, PostgREST, Realtime and the gateway
 * @returns {string} an HS256 JWT
 */
export function signSupabaseKey(role, secret) {
  const header = encode('{"alg":"HS256","typ":"JWT"}');
  const payload = encode(`{"role":"${role}","iss":"supabase","iat":1700000000,"exp":4102444800}`);
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
