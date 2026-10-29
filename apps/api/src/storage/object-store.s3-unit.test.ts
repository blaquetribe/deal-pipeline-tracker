import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({
  send: vi.fn<(command: { input?: unknown }) => Promise<unknown>>(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    S3Client: class {
      send = send;
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
    ListObjectsV2Command: Command,
  };
});

import { createObjectStore } from './object-store';

const config = {
  driver: 's3' as const,
  directory: '/tmp',
  endpoint: 'http://storage.test',
  region: 'auto',
  bucket: 'files',
  prefix: 'Dev/' as const,
  forcePathStyle: true,
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
};

afterEach(() => send.mockReset());

describe('S3 ObjectStore operations', () => {
  it('sends puts and deletes with the environment prefix and rejects invalid keys', async () => {
    const store = createObjectStore(config);
    send.mockResolvedValue(undefined);
    await store.put('users/u/avatar/id', Readable.from(Buffer.from('img')), 3, 'image/webp');
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: 'files',
      Key: 'Dev/users/u/avatar/id',
      ContentLength: 3,
      ContentType: 'image/webp',
    });
    await store.delete('users/u/avatar/id');
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      Bucket: 'files',
      Key: 'Dev/users/u/avatar/id',
    });
    await expect(store.get('../escape')).rejects.toThrow('Invalid object key');
    await expect(store.put('/absolute', Readable.from([]), 0, 'x')).rejects.toThrow(
      'Invalid object key',
    );
  });

  it('returns null for absent keys or empty bodies and streams valid bodies', async () => {
    const store = createObjectStore(config);
    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    expect(await store.get('missing')).toBeNull();
    send.mockResolvedValueOnce({ Body: undefined });
    expect(await store.get('empty')).toBeNull();
    send.mockResolvedValueOnce({
      Body: { transformToWebStream: () => new Blob(['payload']).stream() },
    });
    const stream = await store.get('present');
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream ?? []) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('payload');
    send.mockRejectedValueOnce(new Error('service unavailable'));
    await expect(store.get('error')).rejects.toThrow('service unavailable');
  });

  it('lists all pages, ignores keys outside its prefix and supplies a missing timestamp', async () => {
    const store = createObjectStore(config);
    const created = new Date('2026-10-29T00:00:00Z');
    send
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'Dev/a', LastModified: created },
          { Key: 'Prod/other', LastModified: created },
          { LastModified: created },
        ],
        IsTruncated: true,
        NextContinuationToken: 'next',
      })
      .mockResolvedValueOnce({ Contents: [{ Key: 'Dev/b' }], IsTruncated: false });
    expect(await store.list()).toEqual([
      { key: 'a', lastModified: created },
      { key: 'b', lastModified: new Date(0) },
    ]);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      ContinuationToken: 'next',
      Prefix: 'Dev/',
    });
  });
});
