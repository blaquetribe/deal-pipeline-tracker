import { Readable } from 'node:stream';

import { Hono } from 'hono';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { RateLimiter } from '../../http/rate-limit';
import type { HttpDeps, SessionResolver } from '../../http/route';
import type { ObjectStore } from '../../storage/object-store';
import { createFileRoutes } from './routes';

const userId = 'aaaaaaaa-0000-4000-8000-000000000001';
const tenantId = 'bbbbbbbb-0000-4000-8000-000000000001';
const fileId = 'cccccccc-0000-4000-8000-000000000001';

function fixture() {
  let stored: Buffer | null = null;
  const put = vi.fn<ObjectStore['put']>(async (_key, body, _size, _type) => {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    stored = Buffer.concat(chunks);
  });
  const deleteObject = vi.fn<ObjectStore['delete']>(async () => undefined);
  const getObject = vi.fn<ObjectStore['get']>(async () => null);
  const rpcCall = vi.fn<
    (name: string, args: Record<string, unknown>, bearer: string) => Promise<unknown>
  >(async (name, _args, _bearer) => (name === 'file_create_pending' ? fileId : undefined));
  const store: ObjectStore = {
    put,
    get: getObject,
    delete: deleteObject,
    list: vi.fn<ObjectStore['list']>(async () => []),
  };
  const userRpc = {
    call: rpcCall,
  };
  const routes = createFileRoutes({ userRpc, store, keyPrefix: 'Dev/', tempDirectory: '/tmp' });
  const app = new Hono();
  const resolveSession = vi.fn<SessionResolver['resolve']>(async () => ({
    sessionId: 'session',
    userId,
    tenantId,
    accessToken: 'user-jwt',
    csrfToken: 'csrf',
  }));
  const http: HttpDeps = {
    appOrigin: 'http://localhost:8080',
    cookieSecure: false,
    resolver: { resolve: resolveSession },
    limiter: {
      hit: vi.fn<RateLimiter['hit']>(() => ({ allowed: true })),
      size: vi.fn<RateLimiter['size']>(() => 0),
    },
    logger: {
      info: vi.fn<HttpDeps['logger']['info']>(() => undefined),
      error: vi.fn<HttpDeps['logger']['error']>(() => undefined),
    },
  };
  routes.forEach((route) => route.mount(app, http));
  return {
    app,
    store,
    userRpc,
    put,
    deleteObject,
    getObject,
    http,
    resolveSession,
    stored: () => stored,
  };
}

describe('file routes', () => {
  it('rejects spoofed avatar content before writing metadata or objects', async () => {
    const { app, put, userRpc } = fixture();
    const response = await app.request('/files/avatar', {
      method: 'POST',
      headers: {
        Cookie: 'dpt_session=session',
        Origin: 'http://localhost:8080',
        'X-CSRF-Token': 'csrf',
        'Content-Type': 'image/png',
      },
      body: Buffer.from('<svg onload="alert(1)"></svg>'),
    });
    expect(response.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('re-encodes an uploaded image as a square WebP and records only server-derived metadata', async () => {
    const { app, put, userRpc, stored } = fixture();
    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const response = await app.request('/files/avatar', {
      method: 'POST',
      headers: {
        Cookie: 'dpt_session=session',
        Origin: 'http://localhost:8080',
        'X-CSRF-Token': 'csrf',
        'Content-Type': 'image/png',
      },
      body: png,
    });
    expect(response.status).toBe(201);
    const data = stored();
    expect(data).not.toBeNull();
    const metadata = await sharp(data ?? undefined).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(userRpc.call).toHaveBeenNthCalledWith(
      1,
      'file_create_pending',
      expect.objectContaining({
        p_tenant: tenantId,
        p_kind: 'avatar',
        p_content_type: 'image/webp',
        p_byte_size: data?.length,
      }),
      'user-jwt',
    );
    expect(userRpc.call).toHaveBeenNthCalledWith(
      2,
      'file_mark_ready',
      { p_file: fileId },
      'user-jwt',
    );
    expect(put).toHaveBeenCalledOnce();
  });

  it('requires CSRF and an authenticated session before streaming upload bytes', async () => {
    const { app, put, userRpc, resolveSession } = fixture();
    const missingCsrf = await app.request('/files/avatar', {
      method: 'POST',
      headers: { Cookie: 'dpt_session=session', Origin: 'http://localhost:8080' },
      body: Buffer.from('image bytes'),
    });
    expect(missingCsrf.status).toBe(403);
    expect(put).not.toHaveBeenCalled();

    resolveSession.mockResolvedValueOnce(null);
    const signedOut = await app.request('/files/avatar', {
      method: 'POST',
      headers: {
        Cookie: 'dpt_session=session',
        Origin: 'http://localhost:8080',
        'X-CSRF-Token': 'csrf',
      },
      body: Buffer.from('image bytes'),
    });
    expect(signedOut.status).toBe(401);
    expect(userRpc.call).not.toHaveBeenCalled();
  });

  it('rejects uploads from a foreign origin and enforces byte limits while streaming', async () => {
    const { app, put } = fixture();
    const badOrigin = await app.request('/files/avatar', {
      method: 'POST',
      headers: {
        Cookie: 'dpt_session=session',
        Origin: 'https://attacker.example',
        'X-CSRF-Token': 'csrf',
      },
      body: Buffer.from('small'),
    });
    expect(badOrigin.status).toBe(403);
    const overLimit = await app.request('/files/avatar', {
      method: 'POST',
      headers: {
        Cookie: 'dpt_session=session',
        Origin: 'http://localhost:8080',
        'X-CSRF-Token': 'csrf',
        'Content-Length': '0',
      },
      body: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    expect(overLimit.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('returns not found when the authorized metadata query cannot see a file', async () => {
    const { app, userRpc } = fixture();
    vi.mocked(userRpc.call).mockResolvedValueOnce(null);
    const response = await app.request(`/files/${fileId}`, {
      headers: { Cookie: 'dpt_session=session' },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('rejects missing tenant, empty body, oversized input and invalid image data', async () => {
    const { app, resolveSession, put } = fixture();
    resolveSession.mockResolvedValueOnce({
      sessionId: 'session',
      userId,
      tenantId: null,
      accessToken: 'user-jwt',
      csrfToken: 'csrf',
    });
    const headers = {
      Cookie: 'dpt_session=session',
      Origin: 'http://localhost:8080',
      'X-CSRF-Token': 'csrf',
    };
    const noTenant = await app.request('/files/avatar', {
      method: 'POST',
      headers,
      body: Buffer.from('data'),
    });
    expect(noTenant.status).toBe(409);

    const empty = await app.request('/files/avatar', { method: 'POST', headers });
    expect(empty.status).toBe(400);

    const oversized = await app.request('/files/avatar', {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(6 * 1024 * 1024) },
      body: 'x',
    });
    expect(oversized.status).toBe(413);

    const malformed = await app.request('/files/avatar', {
      method: 'POST',
      headers,
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(malformed.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts JPEG and WebP signatures and rolls back an object when metadata creation fails', async () => {
    const { app, userRpc, deleteObject } = fixture();
    const headers = {
      Cookie: 'dpt_session=session',
      Origin: 'http://localhost:8080',
      'X-CSRF-Token': 'csrf',
    };
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#112233' },
    })
      .jpeg()
      .toBuffer();
    expect(
      (await app.request('/files/avatar', { method: 'POST', headers, body: jpeg })).status,
    ).toBe(201);

    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#112233' },
    })
      .webp()
      .toBuffer();
    userRpc.call.mockRejectedValueOnce(new Error('database failure'));
    expect(
      (await app.request('/files/avatar', { method: 'POST', headers, body: webp })).status,
    ).toBe(400);
    expect(deleteObject).toHaveBeenCalledOnce();
  });

  it('rejects malformed PDF routes and removes uploaded data if ready marking fails', async () => {
    const { app, userRpc, deleteObject } = fixture();
    const headers = {
      Cookie: 'dpt_session=session',
      Origin: 'http://localhost:8080',
      'X-CSRF-Token': 'csrf',
    };
    expect(
      (await app.request('/deals/nope/files', { method: 'POST', headers, body: '%PDF-1.7' }))
        .status,
    ).toBe(404);
    expect((await app.request(`/deals/${fileId}/files`, { method: 'POST', headers })).status).toBe(
      400,
    );
    expect(
      (await app.request(`/deals/${fileId}/files`, { method: 'POST', headers, body: 'not pdf' }))
        .status,
    ).toBe(415);

    userRpc.call.mockImplementation(async (name) =>
      name === 'file_create_pending' ? fileId : Promise.reject(new Error('mark failed')),
    );
    const response = await app.request(`/deals/${fileId}/files`, {
      method: 'POST',
      headers,
      body: '%PDF-1.7\nvalid enough for signature',
    });
    expect(response.status).toBe(400);
    expect(deleteObject).toHaveBeenCalledOnce();
  });

  it('creates attachment metadata after storing a valid PDF', async () => {
    const { app, userRpc, put } = fixture();
    const response = await app.request(`/deals/${fileId}/files`, {
      method: 'POST',
      headers: {
        Cookie: 'dpt_session=session',
        Origin: 'http://localhost:8080',
        'X-CSRF-Token': 'csrf',
      },
      body: '%PDF-1.7\nattachment payload',
    });
    expect(response.status).toBe(201);
    expect(userRpc.call).toHaveBeenNthCalledWith(
      1,
      'file_create_pending',
      expect.objectContaining({ p_tenant: tenantId, p_kind: 'attachment', p_deal: fileId }),
      'user-jwt',
    );
    expect(put).toHaveBeenCalledOnce();
  });

  it('returns validated deal-file lists and rejects malformed or invalid RPC results', async () => {
    const { app, userRpc } = fixture();
    expect(
      (await app.request('/deals/not-a-uuid/files', { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    userRpc.call.mockResolvedValueOnce([]);
    expect(
      (await app.request(`/deals/${fileId}/files`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(200);
    userRpc.call.mockResolvedValueOnce([{ id: 'not-a-uuid' }]);
    expect(
      (await app.request(`/deals/${fileId}/files`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(500);
  });

  it('serves authorized attachment bytes with safe headers and rejects wrong prefix or missing objects', async () => {
    const { app, userRpc, getObject } = fixture();
    expect(
      (await app.request('/files/not-a-uuid', { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    const metadata = {
      id: fileId,
      object_key: 'Dev/tenants/t/attachment/file',
      content_type: 'application/pdf',
      byte_size: 4,
      kind: 'attachment',
    };
    userRpc.call.mockResolvedValueOnce(metadata);
    getObject.mockResolvedValueOnce(Readable.from(Buffer.from('pdf!')));
    const response = await app.request(`/files/${fileId}`, {
      headers: { Cookie: 'dpt_session=session' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="attachment.pdf"',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe('pdf!');

    userRpc.call.mockResolvedValueOnce({ ...metadata, object_key: 'Prod/elsewhere/file' });
    expect(
      (await app.request(`/files/${fileId}`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    userRpc.call.mockResolvedValueOnce(metadata);
    expect(
      (await app.request(`/files/${fileId}`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    userRpc.call.mockResolvedValueOnce({ ...metadata, id: 'bad-id' });
    expect(
      (await app.request(`/files/${fileId}`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(500);
    userRpc.call.mockResolvedValueOnce({ ...metadata, kind: 'avatar' });
    getObject.mockResolvedValueOnce(Readable.from(Buffer.from('webp')));
    const avatarDownload = await app.request(`/files/${fileId}`, {
      headers: { Cookie: 'dpt_session=session' },
    });
    expect(avatarDownload.headers.get('Content-Disposition')).toBe(
      'inline; filename="avatar.webp"',
    );
  });

  it('serves only avatar metadata and returns not found for missing or malformed avatar references', async () => {
    const { app, userRpc, getObject } = fixture();
    expect(
      (await app.request('/users/nope/avatar', { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    userRpc.call.mockResolvedValueOnce(null);
    expect(
      (await app.request(`/users/${userId}/avatar`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    userRpc.call.mockResolvedValueOnce(fileId).mockResolvedValueOnce({
      id: fileId,
      object_key: 'Dev/users/u/avatar/f',
      content_type: 'image/webp',
      byte_size: 4,
      kind: 'attachment',
    });
    expect(
      (await app.request(`/users/${userId}/avatar`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
    userRpc.call.mockResolvedValueOnce(fileId).mockResolvedValueOnce({
      id: fileId,
      object_key: 'Dev/users/u/avatar/f',
      content_type: 'image/webp',
      byte_size: 4,
      kind: 'avatar',
    });
    getObject.mockResolvedValueOnce(Readable.from(Buffer.from('webp')));
    const response = await app.request(`/users/${userId}/avatar`, {
      headers: { Cookie: 'dpt_session=session' },
    });
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="avatar.webp"');
    userRpc.call.mockResolvedValueOnce(fileId).mockResolvedValueOnce({
      id: fileId,
      object_key: 'Prod/users/u/avatar/f',
      content_type: 'image/webp',
      byte_size: 4,
      kind: 'avatar',
    });
    expect(
      (await app.request(`/users/${userId}/avatar`, { headers: { Cookie: 'dpt_session=session' } }))
        .status,
    ).toBe(404);
  });
});
