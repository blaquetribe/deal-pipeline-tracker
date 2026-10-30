import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn<
    (dealId: string) => Promise<{ files: { id: string; byteSize: number; createdAt: string }[] }>
  >(),
  upload: vi.fn<(dealId: string, file: File) => Promise<string>>(),
}));

vi.mock('./files-api', () => ({ readDealFiles: mocks.read, uploadDealFile: mocks.upload }));

import { DealFiles } from './deal-files';

const dealId = 'aaaaaaaa-0000-4000-8000-000000000001';
const fileId = 'bbbbbbbb-0000-4000-8000-000000000001';

describe('DealFiles', () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.upload.mockReset();
  });

  it('loads and links only authorized attachment ids when opened', async () => {
    mocks.read.mockResolvedValue({
      files: [{ id: fileId, byteSize: 2048, createdAt: '2026-10-29T10:00:00Z' }],
    });
    render(<DealFiles dealId={dealId} />);
    expect(mocks.read).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'View attachments' }));
    expect(await screen.findByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      `/api/files/${fileId}`,
    );
    expect(mocks.read).toHaveBeenCalledWith(dealId);
  });

  it('uploads a selected PDF and refreshes the authorized file list', async () => {
    mocks.read.mockResolvedValue({ files: [] });
    mocks.upload.mockResolvedValue(fileId);
    render(<DealFiles dealId={dealId} />);
    await userEvent.click(screen.getByRole('button', { name: 'View attachments' }));
    const file = new File(['%PDF-1.7'], 'confidential.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByLabelText('Add PDF');
    expect(fileInput).toHaveClass('ui-file-input');
    expect(fileInput.closest('label')).toHaveClass('ui-file-trigger');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(dealId, file));
    expect(await screen.findByText('PDF attached to this deal.')).toBeVisible();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});
