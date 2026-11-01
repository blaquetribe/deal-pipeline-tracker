import { describe, expect, it, vi } from 'vitest';

import { requestCloseAccountMenu, subscribeToCloseAccountMenu } from './account-menu-events';

describe('account menu events', () => {
  it('dispatches to subscribers and supports cleanup', () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeToCloseAccountMenu(listener);

    requestCloseAccountMenu();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestCloseAccountMenu();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is safe to call during server rendering', () => {
    vi.stubGlobal('window', undefined);
    expect(() => requestCloseAccountMenu()).not.toThrow();
    expect(() => subscribeToCloseAccountMenu(vi.fn<() => void>())()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
