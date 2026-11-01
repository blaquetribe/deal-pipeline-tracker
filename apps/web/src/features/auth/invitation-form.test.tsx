import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AuthApi from './api';

const mocks = vi.hoisted(() => ({
  authRequest: vi.fn<(path: string, body: unknown) => Promise<unknown>>(),
  sessionRequest: vi.fn<(path: string, method: 'POST', body: unknown) => Promise<unknown>>(),
}));
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApi>();
  return { ...actual, authRequest: mocks.authRequest, sessionRequest: mocks.sessionRequest };
});
vi.mock('./login-form', () => ({
  LoginForm: ({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) => (
    <button type="button" onClick={() => void onAuthenticated()}>
      Complete sign in
    </button>
  ),
}));

import { InvitationForm } from './invitation-form';

const preview = {
  tenantName: 'Asteron Capital',
  inviterEmail: 'owner@example.test',
  roleName: 'Deal Lead',
  email: 'lead@example.test',
  organisationNameIsSelfDeclared: true as const,
};

describe('InvitationForm', () => {
  beforeEach(() => {
    mocks.authRequest.mockReset();
    mocks.sessionRequest.mockReset().mockResolvedValue(undefined);
  });

  it('explains when the invitation token is missing or the preview cannot load', async () => {
    render(<InvitationForm token={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
    expect(mocks.authRequest).not.toHaveBeenCalled();
    cleanup();

    mocks.authRequest.mockRejectedValueOnce(new Error('Invitation has expired.'));
    render(<InvitationForm token={'a'.repeat(43)} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation has expired.');
  });

  it('validates registration details and explains a sign-in-required response', async () => {
    mocks.authRequest.mockResolvedValueOnce(preview);
    const user = userEvent.setup();
    render(<InvitationForm token={'a'.repeat(43)} />);
    await screen.findByText('Asteron Capital');
    const form = screen.getByRole('button', { name: 'Create account and accept' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your name and password');
    expect(mocks.authRequest).toHaveBeenCalledTimes(1);

    const { ApiClientError } = await import('./api');
    mocks.authRequest.mockRejectedValueOnce(
      new ApiClientError('sign_in_required', 'Sign in required.'),
    );
    await user.type(screen.getByLabelText('Full name'), 'Tara Example');
    await user.type(screen.getByLabelText('Create a password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to accept' })).toBeVisible();
  });

  it('switches an existing account to the invited organisation after sign-in', async () => {
    mocks.authRequest.mockResolvedValueOnce(preview).mockResolvedValueOnce({
      accepted: false,
      signInRequired: true,
      tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
    });
    render(<InvitationForm token={'a'.repeat(43)} />);
    await screen.findByText('Asteron Capital');
    await userEvent.type(screen.getByLabelText('Full name'), 'Tara Example');
    await userEvent.type(screen.getByLabelText('Create a password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and accept' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Complete sign in' }));
    expect(mocks.sessionRequest).toHaveBeenCalledWith('/auth/tenant', 'POST', {
      tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
    });
  });

  it('shows a useful registration error without accepting the invitation', async () => {
    mocks.authRequest
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new Error('Registration failed.'));
    render(<InvitationForm token={'a'.repeat(43)} />);
    await screen.findByText('Asteron Capital');
    await userEvent.type(screen.getByLabelText('Full name'), 'Tara Example');
    await userEvent.type(screen.getByLabelText('Create a password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration failed.');
    expect(mocks.sessionRequest).not.toHaveBeenCalled();
  });
});
