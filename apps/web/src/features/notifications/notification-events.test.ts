import { describe, expect, it, vi } from 'vitest';

import { requestOpenNotifications, subscribeToOpenNotifications } from './notification-events';

describe('notification events', () => {
  it('dispatches to subscribers and supports cleanup', () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeToOpenNotifications(listener);

    requestOpenNotifications();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestOpenNotifications();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is safe to call during server rendering', () => {
    vi.stubGlobal('window', undefined);
    expect(() => requestOpenNotifications()).not.toThrow();
    expect(() => subscribeToOpenNotifications(vi.fn<() => void>())()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
