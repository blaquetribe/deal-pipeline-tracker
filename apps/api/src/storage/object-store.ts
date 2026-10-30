import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface ObjectStore {
  put(key: string, body: Readable, byteSize: number, contentType: string): Promise<void>;
  get(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
  list(): Promise<readonly StoredObject[]>;
}

export interface StoredObject {
  readonly key: string;
  readonly lastModified: Date;
}

export interface ObjectStoreConfig {
  readonly driver: 'fs' | 's3';
  readonly directory: string;
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly prefix: 'Dev/' | 'Prod/';
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

function objectKey(config: ObjectStoreConfig, key: string): string {
  if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.startsWith('/') || key.split('/').includes('..')) {
    throw new Error('Invalid object key');
  }
  return `${config.prefix}${key}`;
}

function createFileStore(config: ObjectStoreConfig): ObjectStore {
  const root = resolve(config.directory);
  const pathFor = (key: string) => {
    const path = resolve(root, objectKey(config, key));
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('Invalid object key');
    return path;
  };

  return {
    async put(key, body, byteSize) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      // Stage on the object volume so the final hard link is always same-device.
      // Compose mounts /tmp as tmpfs and the object directory as a named volume.
      const stagingRoot = resolve(root, '.staging');
      await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(resolve(stagingRoot, 'upload-'));
      const stagedPath = resolve(staging, 'object');
      try {
        let written = 0;
        body.on('data', (chunk: Buffer) => {
          written += chunk.length;
        });
        await pipeline(body, createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 }));
        if (written !== byteSize) throw new Error('Object size did not match declared size');
        // The caller's UUID makes keys unique; link avoids replacing any existing object.
        const { link } = await import('node:fs/promises');
        await link(stagedPath, path);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
    async get(key) {
      const path = pathFor(key);
      try {
        const stream = createReadStream(path);
        await new Promise<void>((resolveReady, reject) => {
          stream.once('open', () => resolveReady());
          stream.once('error', reject);
        });
        return stream;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    async list() {
      const base = resolve(root, config.prefix);
      const objects: StoredObject[] = [];
      const walk = async (directory: string): Promise<void> => {
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return;
          throw error;
        }
        await Promise.all(
          entries.map(async (entry) => {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile()) {
              const metadata = await stat(path);
              objects.push({ key: path.slice(base.length + 1), lastModified: metadata.mtime });
            }
          }),
        );
      };
      await walk(base);
      return objects;
    },
  };
}

function createS3Store(config: ObjectStoreConfig): ObjectStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    async put(key, body, byteSize, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey(config, key),
          Body: body,
          ContentLength: byteSize,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(config, key) }),
        );
        if (!result.Body) return null;
        return Readable.fromWeb(result.Body.transformToWebStream());
      } catch (error) {
        if (error instanceof Error && 'name' in error && error.name === 'NoSuchKey') return null;
        throw error;
      }
    },
    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey(config, key) }),
      );
    },
    async list() {
      const objects: StoredObject[] = [];
      let continuationToken: string | undefined;
      do {
        // oxlint-disable-next-line no-await-in-loop -- pagination requires the previous token.
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: config.prefix,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          }),
        );
        for (const item of result.Contents ?? []) {
          if (!item.Key?.startsWith(config.prefix)) continue;
          objects.push({
            key: item.Key.slice(config.prefix.length),
            lastModified: item.LastModified ?? new Date(0),
          });
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
      return objects;
    },
  };
}

export function createObjectStore(config: ObjectStoreConfig): ObjectStore {
  return config.driver === 'fs' ? createFileStore(config) : createS3Store(config);
}
