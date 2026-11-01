import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('opens an account panel from the profile trigger and exposes its actions', async () => {
    const user = userEvent.setup();
    render(
      <ProfileAvatar compact>
        <a href="/settings">Settings</a>
        <button type="button">Notifications</button>
        <button type="button">Dark mode</button>
      </ProfileAvatar>,
    );

    const trigger = await screen.findByRole('button', { name: 'Account menu for Tara Example' });
    await user.hover(trigger);

    expect(await screen.findByRole('region', { name: 'Account options' })).toBeVisible();
    expect(screen.getByText('person@example.test')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeVisible();
  });

  it('closes from Escape and returns focus to the profile trigger', async () => {
    const user = userEvent.setup();
    render(<ProfileAvatar />);

    const trigger = await screen.findByRole('button', { name: 'Account menu for Tara Example' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Account options' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
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
    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Tara Example' }));
    const trigger = screen.getByRole('button', { name: 'Change photo' });
    expect(trigger).toHaveAttribute('data-size', 'small');
    expect(trigger).toHaveAttribute('data-variant', 'quiet');
    const fileInput = screen.getByLabelText('Choose profile photo');
    expect(fileInput).toHaveClass('sr-only');
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
    await userEvent.click(
      await screen.findByRole('button', { name: 'Account menu for Tara Example' }),
    );
    const fileInput = await screen.findByLabelText('Choose profile photo');
    expect(fileInput).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeDisabled();
    expect(screen.getByText('Choose an organisation before changing your photo.')).toBeVisible();
  });

  it.each([
    [413, 'Choose an image under 5 MB.'],
    [415, 'Choose a readable PNG, JPEG, or WebP photo.'],
    [401, 'Your session ended. Sign in again to update your photo.'],
    [500, 'Your photo could not be saved. Try again.'],
  ])('explains avatar upload response %i', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    render(<ProfileAvatar />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Account menu for Tara Example' }),
    );
    const fileInput = screen.getByLabelText('Choose profile photo');
    fireEvent.change(fileInput, {
      target: { files: [new File(['image bytes'], 'avatar.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText(message)).toBeVisible();
    expect(fileInput).toHaveValue('');
  });

  it('closes the account panel when focus moves outside it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ProfileAvatar />
        <button type="button">Outside</button>
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Account menu for Tara Example' }));
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('region', { name: 'Account options' })).not.toBeInTheDocument();
  });

  it('falls back to initials when the saved avatar cannot be loaded', async () => {
    const { container } = render(<ProfileAvatar />);
    expect(
      await screen.findByRole('button', { name: 'Account menu for Tara Example' }),
    ).toBeVisible();
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(screen.getByText('TE')).toBeVisible();
  });

  it('uses a neutral account label when the profile has no name', async () => {
    mocks.read.mockResolvedValueOnce({
      ...session,
      user: { ...session.user, fullName: null },
    });
    render(<ProfileAvatar />);
    expect(await screen.findByRole('button', { name: 'Account menu' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getAllByText('?')).toHaveLength(2);
    expect(screen.getByText('person@example.test')).toBeVisible();
  });
});
