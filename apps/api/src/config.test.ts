import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults the port', () => {
    expect(loadConfig({}).PORT).toBe(3001);
  });

  it('coerces a numeric port string', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '65536', 'abc', '-1', '3.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });
});
