const OPEN_NOTIFICATIONS_EVENT = 'dpt:open-notifications';

export function requestOpenNotifications(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
}

export function subscribeToOpenNotifications(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(OPEN_NOTIFICATIONS_EVENT, listener);
  return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, listener);
}
