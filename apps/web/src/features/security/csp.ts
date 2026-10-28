export function buildCsp(nonce: string, appOrigin: string, development: boolean): string {
  const app = new URL(appOrigin);
  if (app.protocol !== 'http:' && app.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTP or HTTPS');
  }
  const websocket = `${app.protocol === 'https:' ? 'wss:' : 'ws:'}//${app.host}`;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    `connect-src 'self' ${websocket}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return `${directives.join('; ')};`;
}
