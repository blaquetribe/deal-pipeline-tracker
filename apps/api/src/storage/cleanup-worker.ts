import { z } from 'zod';

import type { Logger } from '../http/route';
import type { ObjectStore } from './object-store';

const keysSchema = z.array(z.string());
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface FileCleanupWorkerOptions {
  readonly rpc: { call(name: string, args: Record<string, unknown>): Promise<unknown> };
  readonly store: ObjectStore;
  readonly keyPrefix: 'Dev/' | 'Prod/';
  readonly logger: Logger;
  readonly now?: () => number;
}

export function createFileCleanupWorker({
  rpc,
  store,
  keyPrefix,
  logger,
  now = Date.now,
}: FileCleanupWorkerOptions) {
  return {
    async run(): Promise<number> {
      try {
        const [staleResult, knownResult, objects] = await Promise.all([
          rpc.call('file_cleanup_stale_pending', {}),
          rpc.call('file_list_object_keys', {}),
          store.list(),
        ]);
        const staleKeys = keysSchema.parse(staleResult);
        const knownKeys = keysSchema.parse(knownResult);
        const activeKnownKeys = new Set(
          knownKeys
            .filter((key) => key.startsWith(keyPrefix))
            .map((key) => key.slice(keyPrefix.length)),
        );
        const deleteKeys = new Set<string>();
        for (const key of staleKeys) {
          if (!key.startsWith(keyPrefix)) continue;
          deleteKeys.add(key.slice(keyPrefix.length));
        }
        for (const object of objects) {
          if (
            !activeKnownKeys.has(object.key) &&
            now() - object.lastModified.getTime() >= ORPHAN_GRACE_MS
          ) {
            deleteKeys.add(object.key);
          }
        }
        await Promise.all([...deleteKeys].map((key) => store.delete(key)));
        const deleted = deleteKeys.size;
        if (deleted > 0) logger.info('file storage cleanup completed', { deleted });
        return deleted;
      } catch (error) {
        logger.error('file storage cleanup failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        return 0;
      }
    },
  };
}
