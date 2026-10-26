import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './rate-limit';

describe('rate limiter', () => {
  it('allows up to the limit inside a window, then refuses with a retry delay', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter(() => now);
    const rule = { limit: 3, windowSeconds: 60 };

    expect(limiter.hit('k', rule)).toEqual({ allowed: true });
    expect(limiter.hit('k', rule)).toEqual({ allowed: true });
    expect(limiter.hit('k', rule)).toEqual({ allowed: true });
    now += 10_000;
    expect(limiter.hit('k', rule)).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it('lets traffic through again once the window has passed', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now);
    const rule = { limit: 1, windowSeconds: 10 };
    limiter.hit('k', rule);
    expect(limiter.hit('k', rule).allowed).toBe(false);
    now = 10_001;
    expect(limiter.hit('k', rule).allowed).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = createRateLimiter(() => 0);
    const rule = { limit: 1, windowSeconds: 10 };
    expect(limiter.hit('a', rule).allowed).toBe(true);
    expect(limiter.hit('b', rule).allowed).toBe(true);
    expect(limiter.hit('a', rule).allowed).toBe(false);
  });

  it('forgets expired keys so memory stays bounded', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now, { maxKeys: 10 });
    const rule = { limit: 5, windowSeconds: 1 };
    for (let i = 0; i < 10; i += 1) {
      limiter.hit(`old-${i.toString()}`, rule);
    }
    now = 5000;
    limiter.hit('fresh', rule);
    expect(limiter.size()).toBe(1);
  });

  it('refuses new keys rather than grow without bound when full of live keys', () => {
    const limiter = createRateLimiter(() => 0, { maxKeys: 3 });
    const rule = { limit: 5, windowSeconds: 60 };
    for (let i = 0; i < 3; i += 1) {
      limiter.hit(`k${i.toString()}`, rule);
    }
    expect(limiter.hit('overflow', rule)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.size()).toBe(3);
  });
});
