import { Readable } from 'node:stream';

import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createObjectStore, type ObjectStore } from './object-store';

const endpoint = process.env.STORAGE_TEST_ENDPOINT;
const accessKeyId = process.env.STORAGE_TEST_ACCESS_KEY_ID;
const secretAccessKey = process.env.STORAGE_TEST_SECRET_ACCESS_KEY;
const bucket = `dpt-storage-test-${process.env.GITHUB_RUN_ID ?? 'local'}`.toLowerCase();

describe.skipIf(!endpoint || !accessKeyId || !secretAccessKey)(
  'S3 ObjectStore contract (RustFS)',
  () => {
    let client: S3Client;
    let store: ObjectStore;

    beforeAll(async () => {
      client = new S3Client({
        endpoint: endpoint ?? '',
        region: 'auto',
        forcePathStyle: true,
        credentials: { accessKeyId: accessKeyId ?? '', secretAccessKey: secretAccessKey ?? '' },
      });
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- retries wait on RustFS startup in order.
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
          ready = true;
        } catch (error) {
          if (attempt === 29) throw error;
          // oxlint-disable-next-line no-await-in-loop -- startup retry must be delayed before retrying.
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      store = createObjectStore({
        driver: 's3',
        directory: '/tmp',
        endpoint: endpoint ?? '',
        region: 'auto',
        bucket,
        prefix: 'Dev/',
        forcePathStyle: true,
        accessKeyId: accessKeyId ?? '',
        secretAccessKey: secretAccessKey ?? '',
      });
    }, 35_000);

    afterAll(async () => {
      await client?.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
      client?.destroy();
    });

    it('stores, streams and deletes objects under the configured environment prefix', async () => {
      const payload = Buffer.from('RustFS object store contract');
      const key = `contracts/${crypto.randomUUID()}`;
      await store.put(key, Readable.from(payload), payload.length, 'application/octet-stream');
      expect((await store.list()).map((object) => object.key)).toContain(key);
      const stream = await store.get(key);
      if (!stream) throw new Error('Expected stored object');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(payload);
      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    });
  },
);
