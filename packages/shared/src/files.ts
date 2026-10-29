import { z } from 'zod';

export const dealFilesResponseSchema = z.strictObject({
  files: z.array(
    z.strictObject({
      id: z.uuid(),
      byteSize: z.number().int().positive(),
      createdAt: z.iso.datetime({ offset: true }),
    }),
  ),
});

export const fileUploadResponseSchema = z.strictObject({ fileId: z.uuid() });
