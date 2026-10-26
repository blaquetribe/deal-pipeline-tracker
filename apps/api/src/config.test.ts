import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

const base = {
  SUPABASE_URL: 'http://supabase-gateway:8000',
  JWT_SECRET: 'j'.repeat(32),
  SESSION_SECRET: 's'.repeat(32),
};

describe('loadConfig', () => {
  it('defaults the port, the origin and the mail settings', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      PORT: 3001,
      APP_ORIGIN: 'http://localhost:8080',
      SMTP_HOST: 'mailpit',
      SMTP_PORT: 1025,
      MAIL_FROM: 'no-reply@dpt.local',
      cookieSecure: false,
    });
  });

  it('coerces a numeric port string', () => {
    expect(loadConfig({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '-1', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ ...base, PORT: port })).toThrow(/PORT/);
  });

  it('normalises the origin to scheme and host and marks https cookies Secure', () => {
    const config = loadConfig({ ...base, APP_ORIGIN: 'https://deals.example.com/some/path/' });
    expect(config.APP_ORIGIN).toBe('https://deals.example.com');
    expect(config.cookieSecure).toBe(true);
  });

  it.each(['JWT_SECRET', 'SESSION_SECRET', 'SUPABASE_URL'])('requires %s', (name) => {
    const env: Record<string, string | undefined> = { ...base };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(new RegExp(name));
  });

  it('rejects secrets shorter than 32 characters', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});
