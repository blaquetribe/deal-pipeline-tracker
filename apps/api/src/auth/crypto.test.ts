import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  hmacHex,
  randomToken,
  safeEqual,
  sha256Hex,
} from './crypto';

describe('sha256Hex', () => {
  it('matches the known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('randomToken', () => {
  it('is 43 base64url characters (32 bytes) and never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe('safeEqual', () => {
  it.each([
    ['same', 'same', true],
    ['same', 'sam3', false],
    ['same', 'samee', false],
    ['', '', true],
    ['a', '', false],
  ])('compares %j and %j', (a, b, expected) => {
    expect(safeEqual(a, b)).toBe(expected);
  });
});

describe('deriveKey', () => {
  it('derives a 32 byte key, different per purpose and per secret', () => {
    const secret = 'dev-only-session-secret-minimum-32-characters';
    const a = deriveKey(secret, 'session');
    expect(a).toHaveLength(32);
    expect(a.equals(deriveKey(secret, 'session'))).toBe(true);
    expect(a.equals(deriveKey(secret, 'csrf'))).toBe(false);
    expect(a.equals(deriveKey(`${secret}x`, 'session'))).toBe(false);
  });
});

describe('encryptSecret / decryptSecret', () => {
  const key = deriveKey('dev-only-session-secret-minimum-32-characters', 'session');

  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('refresh-token-value', key);
    const b = encryptSecret('refresh-token-value', key);
    expect(decryptSecret(a, key)).toBe('refresh-token-value');
    expect(a.equals(b)).toBe(false);
    expect(a.toString('utf8')).not.toContain('refresh-token-value');
  });

  it('refuses a tampered blob, a truncated blob, an unknown version and the wrong key', () => {
    const blob = encryptSecret('secret', key);
    const flipped = Buffer.from(blob);
    flipped[flipped.length - 1] = (flipped.at(-1) ?? 0) ^ 1;
    expect(() => decryptSecret(flipped, key)).toThrow(/authenticate/);
    expect(() => decryptSecret(blob.subarray(0, 20), key)).toThrow(/truncated/);
    const unknownVersion = Buffer.from(blob);
    unknownVersion[0] = 9;
    expect(() => decryptSecret(unknownVersion, key)).toThrow(/version/);
    expect(() =>
      decryptSecret(blob, deriveKey('another-secret-another-secret-123456', 'session')),
    ).toThrow(/authenticate/);
  });
});

describe('hmacHex', () => {
  it('is deterministic per key and message', () => {
    const key = deriveKey('dev-only-session-secret-minimum-32-characters', 'csrf');
    expect(hmacHex(key, 'm')).toBe(hmacHex(key, 'm'));
    expect(hmacHex(key, 'm')).not.toBe(hmacHex(key, 'n'));
    expect(hmacHex(key, 'm')).toMatch(/^[0-9a-f]{64}$/);
  });
});
