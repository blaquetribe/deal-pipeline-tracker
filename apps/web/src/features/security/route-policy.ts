const PUBLIC_PAGES: ReadonlySet<string> = new Set([
  '/login',
  '/signup',
  '/check-email',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/accept-invitation',
]);

export function requiresSessionCookie(pathname: string): boolean {
  return !PUBLIC_PAGES.has(pathname);
}
