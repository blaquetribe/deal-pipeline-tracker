export interface RateRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window counter held in this process. It is enough for one API instance (the compose
 * deployment); several instances would need a shared store, which is a README next step. When full of
 * live keys it refuses new ones: fail closed beats unbounded memory.
 */
export function createRateLimiter(now: () => number = Date.now, { maxKeys = 10_000 } = {}) {
  const buckets = new Map<string, Bucket>();

  function prune(at: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) {
        buckets.delete(key);
      }
    }
  }

  return {
    hit(key: string, rule: RateRule): RateDecision {
      const at = now();
      let bucket = buckets.get(key);
      if (bucket && bucket.resetAt <= at) {
        buckets.delete(key);
        bucket = undefined;
      }
      if (!bucket) {
        if (buckets.size >= maxKeys) {
          prune(at);
        }
        if (buckets.size >= maxKeys) {
          return { allowed: false, retryAfterSeconds: rule.windowSeconds };
        }
        bucket = { count: 0, resetAt: at + rule.windowSeconds * 1000 };
        buckets.set(key, bucket);
      }

      if (bucket.count >= rule.limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - at) / 1000) };
      }
      bucket.count += 1;
      return { allowed: true };
    },
    size: () => buckets.size,
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
