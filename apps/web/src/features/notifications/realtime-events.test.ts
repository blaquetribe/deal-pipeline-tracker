import { describe, expect, it, vi } from 'vitest';

import { publishDealsChanged, subscribeToDealsChanged } from './realtime-events';

describe('deal change events', () => {
  it('publishes updates to subscribers and supports cleanup', () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeToDealsChanged(listener);

    publishDealsChanged();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishDealsChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is safe to call during server rendering', () => {
    vi.stubGlobal('window', undefined);
    expect(() => publishDealsChanged()).not.toThrow();
    expect(() => subscribeToDealsChanged(vi.fn<() => void>())()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
