import {
  authSessionResponseSchema,
  dealFilesResponseSchema,
  fileUploadResponseSchema,
} from '@dpt/shared';

import { ApiClientError, sessionRead } from '../auth/api';

export async function readDealFiles(dealId: string) {
  return dealFilesResponseSchema.parse(await sessionRead(`/deals/${dealId}/files`));
}

export async function uploadDealFile(dealId: string, file: File): Promise<string> {
  const session = authSessionResponseSchema.parse(await sessionRead('/auth/session'));
  const response = await fetch(`/api/deals/${dealId}/files`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'X-CSRF-Token': session.csrfToken,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!response.ok) {
    if (response.status === 413)
      throw new ApiClientError('payload_too_large', 'Choose a PDF under 20 MB.');
    throw new ApiClientError('upload_failed', 'The attachment could not be uploaded.');
  }
  return fileUploadResponseSchema.parse(await response.json()).fileId;
}
