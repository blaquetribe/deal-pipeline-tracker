import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionRead } from '../auth/api';
import { readDealFiles, uploadDealFile } from './files-api';

const session = {
  user: {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    email: 'reviewer@example.test',
    fullName: 'Reviewer',
  },
  tenantId: 'bbbbbbbb-0000-4000-8000-000000000001',
  csrfToken: 'csrf',
};

vi.mock('../auth/api', () => ({
  ApiClientError: class MockApiClientError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  sessionRead: vi.fn<(path: string) => Promise<unknown>>(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('deal files API', () => {
  it('reads and validates the deal file list', async () => {
    vi.mocked(sessionRead).mockResolvedValueOnce({ files: [] });
    await expect(readDealFiles('deal-id')).resolves.toEqual({ files: [] });
    expect(sessionRead).toHaveBeenCalledWith('/deals/deal-id/files');
  });

  it('uploads with the session CSRF token and returns the validated file id', async () => {
    vi.mocked(sessionRead).mockResolvedValueOnce(session);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ fileId: 'f62e6f68-9eb8-4abe-bdfb-546fafe86a57' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['%PDF-1.7'], 'proof.pdf', { type: 'application/pdf' });
    await expect(uploadDealFile('deal-id', file)).resolves.toBe(
      'f62e6f68-9eb8-4abe-bdfb-546fafe86a57',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/deals/deal-id/files',
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-CSRF-Token': 'csrf', 'Content-Type': 'application/pdf' },
        body: file,
      }),
    );
  });

  it('maps oversized and generic upload failures to safe client errors', async () => {
    vi.mocked(sessionRead).mockResolvedValue(session);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 413 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['data'], 'proof.pdf');
    await expect(uploadDealFile('deal-id', file)).rejects.toMatchObject({
      code: 'payload_too_large',
    });
    await expect(uploadDealFile('deal-id', file)).rejects.toMatchObject({ code: 'upload_failed' });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/octet-stream',
    });
  });
});
