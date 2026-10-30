import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn<() => Promise<unknown>>() }));
vi.mock('./api', () => ({ sessionRead: mocks.read }));

import { ProfileAvatar } from './profile-avatar';

const session = {
  user: {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    email: 'person@example.test',
    fullName: 'Tara Example',
  },
  tenantId: 'bbbbbbbb-0000-4000-8000-000000000001',
  csrfToken: 'csrf-test',
};

describe('ProfileAvatar', () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockResolvedValue(session);
  });

  it('uses initials and uploads an image with the session CSRF token', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ fileId: 'cccccccc-0000-4000-8000-000000000001' }), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetch);
    render(<ProfileAvatar />);
    expect(await screen.findByText('TE')).toBeVisible();
    const fileInput = screen.getByLabelText('Change photo');
    expect(fileInput).toHaveClass('ui-file-input');
    expect(fileInput.closest('label')).toHaveClass('ui-file-trigger');
    const image = new File(['image bytes'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [image] } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/files/avatar',
        expect.objectContaining({
          headers: { 'X-CSRF-Token': 'csrf-test', 'Content-Type': 'image/png' },
          body: image,
        }),
      ),
    );
    expect(await screen.findByText('Profile photo updated.')).toBeVisible();
  });

  it('disables photo selection until an organisation is selected', async () => {
    mocks.read.mockResolvedValueOnce({ ...session, tenantId: null });
    render(<ProfileAvatar />);
    const fileInput = await screen.findByLabelText('Change photo');
    expect(fileInput).toBeDisabled();
    expect(screen.getByText('Choose an organisation before changing your photo.')).toBeVisible();
  });
});
