import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { dealFilesResponseSchema } from '@dpt/shared';
import sharp from 'sharp';
import { z } from 'zod';

import { HttpError } from '../../http/errors';
import { noBody, sessionRoute, streamSessionRoute, type Route } from '../../http/route';
import type { ObjectStore } from '../../storage/object-store';

const MAX_AVATAR_INPUT = 5 * 1024 * 1024;
const MAX_ATTACHMENT = 20 * 1024 * 1024;
const fileIdSchema = z.uuid();
const dealIdSchema = z.uuid();
const metadataSchema = z.strictObject({
  id: z.uuid(),
  object_key: z.string().min(1),
  content_type: z.enum(['image/webp', 'application/pdf']),
  byte_size: z.number().int().positive(),
  kind: z.enum(['avatar', 'attachment']),
});

export interface FileRoutesOptions {
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
  readonly store: ObjectStore;
  readonly keyPrefix: 'Dev/' | 'Prod/';
  readonly tempDirectory: string;
}

async function signature(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function avatarType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export function createFileRoutes({
  userRpc,
  store,
  keyPrefix,
  tempDirectory,
}: FileRoutesOptions): Route[] {
  const uploadAvatar = streamSessionRoute({
    method: 'POST',
    path: '/files/avatar',
    permission: 'profile.edit',
    maxBytes: MAX_AVATAR_INPUT,
    handler: async ({ body, session }) => {
      if (!session.tenantId)
        throw new HttpError(409, 'tenant_required', 'Choose an organisation first.');
      if (!body) throw new HttpError(400, 'invalid_request', 'Choose an image to upload.');
      const directory = await mkdtemp(resolve(tempDirectory, 'dpt-avatar-'));
      const inputPath = resolve(directory, 'input');
      const outputPath = resolve(directory, 'avatar.webp');
      try {
        await pipeline(
          Readable.fromWeb(body),
          createWriteStream(inputPath, { flags: 'wx', mode: 0o600 }),
        );
        const inputType = avatarType(await signature(inputPath));
        if (!inputType)
          throw new HttpError(415, 'unsupported_media_type', 'Use a PNG, JPEG, or WebP image.');
        try {
          await sharp(inputPath, { limitInputPixels: 20_000_000, animated: false })
            .rotate()
            .resize(256, 256, { fit: 'cover', position: 'attention' })
            .webp({ quality: 82 })
            .toFile(outputPath);
        } catch {
          throw new HttpError(
            415,
            'invalid_image',
            'This image could not be read. Choose a PNG, JPEG, or WebP photo.',
          );
        }
        const fileStat = await stat(outputPath);
        const digest = await hashFile(outputPath);
        const objectId = randomUUID();
        const key = `users/${session.userId}/avatar/${objectId}-${digest}`;
        await store.put(key, createReadStream(outputPath), fileStat.size, 'image/webp');
        let createdFileId: string;
        try {
          createdFileId = fileIdSchema.parse(
            await userRpc.call(
              'file_create_pending',
              {
                p_tenant: session.tenantId,
                p_kind: 'avatar',
                p_deal: null,
                p_object_key: `${keyPrefix}${key}`,
                p_content_sha256: digest,
                p_content_type: 'image/webp',
                p_byte_size: fileStat.size,
              },
              session.accessToken,
            ),
          );
          await userRpc.call('file_mark_ready', { p_file: createdFileId }, session.accessToken);
        } catch (error) {
          await store.delete(key).catch(() => undefined);
          throw error;
        }
        return Response.json({ fileId: createdFileId }, { status: 201 });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });

  const uploadAttachment = streamSessionRoute({
    method: 'POST',
    path: '/deals/:dealId/files',
    permission: 'deal.edit',
    maxBytes: MAX_ATTACHMENT,
    handler: async ({ body, params, session }) => {
      const deal = dealIdSchema.safeParse(params.dealId);
      if (!deal.success || !session.tenantId)
        throw new HttpError(404, 'not_found', 'The deal was not found.');
      if (!body) throw new HttpError(400, 'invalid_request', 'Choose a PDF to upload.');
      const directory = await mkdtemp(resolve(tempDirectory, 'dpt-file-'));
      const path = resolve(directory, 'input');
      try {
        await pipeline(
          Readable.fromWeb(body),
          createWriteStream(path, { flags: 'wx', mode: 0o600 }),
        );
        if ((await signature(path)).toString('ascii', 0, 5) !== '%PDF-') {
          throw new HttpError(415, 'unsupported_media_type', 'Only PDF attachments are supported.');
        }
        const fileStat = await stat(path);
        const digest = await hashFile(path);
        const objectId = randomUUID();
        const key = `tenants/${session.tenantId}/attachment/${objectId}-${digest}`;
        await store.put(key, createReadStream(path), fileStat.size, 'application/pdf');
        let createdFileId: string;
        try {
          createdFileId = fileIdSchema.parse(
            await userRpc.call(
              'file_create_pending',
              {
                p_tenant: session.tenantId,
                p_kind: 'attachment',
                p_deal: deal.data,
                p_object_key: `${keyPrefix}${key}`,
                p_content_sha256: digest,
                p_content_type: 'application/pdf',
                p_byte_size: fileStat.size,
              },
              session.accessToken,
            ),
          );
          await userRpc.call('file_mark_ready', { p_file: createdFileId }, session.accessToken);
        } catch (error) {
          await store.delete(key).catch(() => undefined);
          throw error;
        }
        return Response.json({ fileId: createdFileId }, { status: 201 });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });

  const listDealFiles = sessionRoute({
    method: 'GET',
    path: '/deals/:dealId/files',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ params, session }) => {
      const deal = dealIdSchema.safeParse(params.dealId);
      if (!deal.success) throw new HttpError(404, 'not_found', 'The deal was not found.');
      return {
        body: dealFilesResponseSchema.parse({
          files: await userRpc.call(
            'file_list_for_deal',
            { p_deal: deal.data },
            session.accessToken,
          ),
        }),
      };
    },
  });

  const download = streamSessionRoute({
    method: 'GET',
    path: '/files/:fileId',
    maxBytes: 0,
    permission: 'file.view',
    handler: async ({ params, session }) => {
      const id = fileIdSchema.safeParse(params.fileId);
      if (!id.success) throw new HttpError(404, 'not_found', 'The file was not found.');
      const metadata = metadataSchema
        .nullable()
        .parse(await userRpc.call('file_metadata', { p_file: id.data }, session.accessToken));
      if (!metadata) throw new HttpError(404, 'not_found', 'The file was not found.');
      const key = metadata.object_key.startsWith(keyPrefix)
        ? metadata.object_key.slice(keyPrefix.length)
        : null;
      if (!key) throw new HttpError(404, 'not_found', 'The file was not found.');
      const stream = await store.get(key);
      if (!stream) throw new HttpError(404, 'not_found', 'The file was not found.');
      const headers = new Headers({
        'Content-Type': metadata.content_type,
        'Content-Length': String(metadata.byte_size),
        'Content-Disposition':
          metadata.kind === 'attachment'
            ? 'attachment; filename="attachment.pdf"'
            : 'inline; filename="avatar.webp"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });
      return new Response(Readable.toWeb(stream), { status: 200, headers });
    },
  });

  const avatar = streamSessionRoute({
    method: 'GET',
    path: '/users/:userId/avatar',
    maxBytes: 0,
    permission: 'profile.view',
    handler: async ({ params, session }) => {
      const userId = z.uuid().safeParse(params.userId);
      if (!userId.success) throw new HttpError(404, 'not_found', 'The avatar was not found.');
      const avatarId = z
        .uuid()
        .nullable()
        .parse(await userRpc.call('file_avatar_id', { p_user: userId.data }, session.accessToken));
      if (!avatarId) throw new HttpError(404, 'not_found', 'The avatar was not found.');
      const metadata = metadataSchema.parse(
        await userRpc.call('file_metadata', { p_file: avatarId }, session.accessToken),
      );
      if (metadata.kind !== 'avatar')
        throw new HttpError(404, 'not_found', 'The avatar was not found.');
      const key = metadata.object_key.startsWith(keyPrefix)
        ? metadata.object_key.slice(keyPrefix.length)
        : null;
      if (!key) throw new HttpError(404, 'not_found', 'The avatar was not found.');
      const stream = await store.get(key);
      if (!stream) throw new HttpError(404, 'not_found', 'The avatar was not found.');
      return new Response(Readable.toWeb(stream), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(metadata.byte_size),
          'Content-Disposition': 'inline; filename="avatar.webp"',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  });

  return [uploadAvatar, uploadAttachment, listDealFiles, download, avatar];
}
