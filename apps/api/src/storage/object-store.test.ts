import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { createObjectStore, type ObjectStoreConfig } from './object-store';

const directories: string[] = [];
const config = async (): Promise<ObjectStoreConfig> => {
  const directory = await mkdtemp(resolve(tmpdir(), 'dpt-store-test-'));
  directories.push(directory);
  return {
    driver: 'fs',
    directory,
    endpoint: 'http://localhost',
    region: 'auto',
    bucket: 'test',
    prefix: 'Dev/',
    forcePathStyle: true,
    accessKeyId: '',
    secretAccessKey: '',
  };
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('filesystem ObjectStore', () => {
  it('writes immutable objects and streams them back under the configured prefix', async () => {
    const store = createObjectStore(await config());
    const payload = Buffer.from('private file');
    await store.put(
      'users/user-1/avatar/file-1',
      Readable.from(payload),
      payload.length,
      'image/webp',
    );
    const stream = await store.get('users/user-1/avatar/file-1');
    if (!stream) throw new Error('Expected stored object');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(payload);
    expect((await store.list()).map((object) => object.key)).toEqual([
      'users/user-1/avatar/file-1',
    ]);
    await expect(
      store.put('users/user-1/avatar/file-1', Readable.from(payload), payload.length, 'image/webp'),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('rejects path traversal and reports missing objects without leaking paths', async () => {
    const store = createObjectStore(await config());
    await expect(store.get('../outside')).rejects.toThrow('Invalid object key');
    expect(await store.get('missing')).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});
