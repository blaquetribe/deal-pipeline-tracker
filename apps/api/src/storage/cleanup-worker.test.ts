import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../http/route';
import { createFileCleanupWorker } from './cleanup-worker';
import type { ObjectStore, StoredObject } from './object-store';

const old = new Date('2026-10-27T00:00:00Z');
const recent = new Date('2026-10-29T00:00:00Z');

interface Options {
  staleKeys?: string[];
  knownKeys?: string[];
  objects?: StoredObject[];
  rpcFailure?: boolean;
}

function makeWorker(options: Options = {}) {
  const staleKeys = options.staleKeys ?? ['Dev/pending/stale'];
  const knownKeys = options.knownKeys ?? ['Dev/keep/known'];
  const objects = options.objects ?? [
    { key: 'pending/stale', lastModified: old },
    { key: 'keep/known', lastModified: old },
    { key: 'orphan/old', lastModified: old },
    { key: 'orphan/recent', lastModified: recent },
  ];
  const call = vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(
    async (name) => {
      if (options.rpcFailure) throw new Error('database unavailable');
      return name === 'file_cleanup_stale_pending' ? staleKeys : knownKeys;
    },
  );
  const deleteObject = vi.fn<ObjectStore['delete']>(async () => undefined);
  const store: ObjectStore = {
    put: vi.fn<ObjectStore['put']>(async () => undefined),
    get: vi.fn<ObjectStore['get']>(async () => null),
    delete: deleteObject,
    list: vi.fn<ObjectStore['list']>(async () => objects),
  };
  const info = vi.fn<Logger['info']>(() => undefined);
  const error = vi.fn<Logger['error']>(() => undefined);
  const logger = { info, error };
  const worker = createFileCleanupWorker({
    rpc: { call },
    store,
    keyPrefix: 'Dev/',
    logger,
    now: () => new Date('2026-10-29T12:00:00Z').getTime(),
  });
  return { worker, call, store, logger, deleteObject, info, error };
}

describe('file cleanup worker', () => {
  it('removes aged pending rows and old unreferenced objects but keeps live and recent objects', async () => {
    const { worker, deleteObject, call, info } = makeWorker();
    expect(await worker.run()).toBe(2);
    expect(call).toHaveBeenCalledWith('file_cleanup_stale_pending', {});
    expect(call).toHaveBeenCalledWith('file_list_object_keys', {});
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith('pending/stale');
    expect(deleteObject).toHaveBeenCalledWith('orphan/old');
    expect(info).toHaveBeenCalledWith('file storage cleanup completed', { deleted: 2 });
  });

  it('does not delete objects from the other environment prefix', async () => {
    const { worker, deleteObject } = makeWorker({
      staleKeys: ['Prod/other/key'],
      objects: [{ key: 'recent', lastModified: recent }],
    });
    expect(await worker.run()).toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('logs a safe failure and keeps the worker alive when database cleanup fails', async () => {
    const { worker, error, deleteObject } = makeWorker({ rpcFailure: true });
    expect(await worker.run()).toBe(0);
    expect(error).toHaveBeenCalledWith('file storage cleanup failed', { error: 'Error' });
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
