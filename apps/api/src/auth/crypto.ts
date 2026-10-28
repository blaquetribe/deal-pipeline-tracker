import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 32 bytes from the CSPRNG, base64url (SECURITY_STANDARDS: tokens). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

/** One 32 byte key per purpose from a configured secret, so a leak of one use does not expose another. */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'dpt-api', purpose, 32));
}

export function hmacHex(key: Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

/** AES-256-GCM. Layout: version (1) | iv (12) | tag (16) | ciphertext. */
export function encryptSecret(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function decryptSecret(blob: Buffer, key: Buffer): string {
  if (blob.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('encrypted value is truncated');
  }
  if (blob[0] !== VERSION) {
    throw new Error('unsupported encryption version');
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(blob.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
