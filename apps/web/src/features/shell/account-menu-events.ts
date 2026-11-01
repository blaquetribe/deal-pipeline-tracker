const CLOSE_ACCOUNT_MENU_EVENT = 'dpt:close-account-menu';

export function requestCloseAccountMenu(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOSE_ACCOUNT_MENU_EVENT));
}

export function subscribeToCloseAccountMenu(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CLOSE_ACCOUNT_MENU_EVENT, listener);
  return () => window.removeEventListener(CLOSE_ACCOUNT_MENU_EVENT, listener);
}
