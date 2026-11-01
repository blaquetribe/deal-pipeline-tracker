const DEALS_CHANGED_EVENT = 'dpt:deals-changed';

export function publishDealsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEALS_CHANGED_EVENT));
}

export function subscribeToDealsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(DEALS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(DEALS_CHANGED_EVENT, listener);
}
