import { NextResponse, type NextRequest } from 'next/server';

import { buildCsp, requiresSessionCookie } from './features/security';

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get('dpt_session')?.value || request.cookies.get('__Host-dpt_session')?.value,
  );
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const appOrigin = process.env.APP_ORIGIN ?? request.nextUrl.origin;
  const policy = buildCsp(nonce, appOrigin, process.env.NODE_ENV === 'development');
  const path = request.nextUrl.pathname;

  if (requiresSessionCookie(path) && !hasSessionCookie(request)) {
    const login = NextResponse.redirect(new URL('/login', request.url));
    login.headers.set('Content-Security-Policy', policy);
    return login;
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-nonce', nonce);
  forwardedHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
