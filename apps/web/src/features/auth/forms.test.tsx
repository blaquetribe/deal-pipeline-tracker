import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn<(path: string) => void>(),
  refresh: vi.fn<() => void>(),
  authRequest: vi.fn<(path: string, body: unknown) => Promise<unknown>>(),
  sessionRequest: vi.fn<(path: string, method: string, body?: unknown) => Promise<unknown>>(),
  sessionRead: vi.fn<(path: string) => Promise<unknown>>(),
  reloadCurrentPage: vi.fn<() => void>(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('./api', () => ({
  ApiClientError: class ApiClientError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  authRequest: mocks.authRequest,
  sessionRequest: mocks.sessionRequest,
  sessionRead: mocks.sessionRead,
}));
vi.mock('./navigation', () => ({ reloadCurrentPage: mocks.reloadCurrentPage }));

import { ApiClientError } from './api';
import { AuthShell } from './auth-shell';
import { InvitationForm } from './invitation-form';
import { LoginForm } from './login-form';
import { PendingInvitations } from './pending-invitations';
import { ResendForm } from './resend-form';
import { ResetPasswordForm } from './reset-password-form';
import { ResetRequestForm } from './reset-request-form';
import { SignOutButton } from './sign-out-button';
import { SignupForm } from './signup-form';
import { TenantSwitcher } from './tenant-switcher';
import { VerifyEmail } from './verify-email';

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.authRequest.mockReset().mockResolvedValue({});
  mocks.sessionRequest.mockReset().mockResolvedValue({});
  mocks.sessionRead.mockReset();
  mocks.reloadCurrentPage.mockReset();
});

describe('authentication forms', () => {
  it('renders the auth shell and signs in, then reports API errors accessibly', async () => {
    const user = userEvent.setup();
    render(
      <AuthShell title="Sign in" description="Access your pipeline">
        <LoginForm />
      </AuthShell>,
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/onboarding'));
    expect(mocks.refresh).toHaveBeenCalled();

    mocks.push.mockReset();
    mocks.authRequest.mockRejectedValueOnce(new Error('Credentials were not accepted.'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credentials were not accepted.');
  });

  it('validates sign-up and sends valid registration to the email confirmation page', async () => {
    const user = userEvent.setup();
    render(<SignupForm />);
    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Work email'), 'ada@example.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters');
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/check-email'));
  });

  it('resends verification with a generic success response and an error response', async () => {
    const user = userEvent.setup();
    render(<ResendForm />);
    await user.type(screen.getByLabelText('Email address'), 'person@example.test');
    await user.click(screen.getByRole('button', { name: 'Resend verification link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If the account needs verification',
    );
    mocks.authRequest.mockRejectedValueOnce('unexpected resend failure');
    await user.click(screen.getByRole('button', { name: 'Resend verification link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request could not be completed. Try again.',
    );
  });

  it('requests a password reset and shows generic success and safe failure messages', async () => {
    const user = userEvent.setup();
    render(<ResetRequestForm />);
    await user.type(screen.getByLabelText('Email address'), 'person@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If the account is eligible');
    mocks.authRequest.mockRejectedValueOnce('unexpected reset request failure');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request could not be completed. Try again.',
    );
  });

  it('rejects a short reset password, completes a valid reset, and supports returning to sign-in', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token={'a'.repeat(43)} />);
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters');
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/Your password has been changed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to sign in' })).toHaveAttribute(
      'href',
      '/login',
    );

    render(<ResetPasswordForm token={null} />);
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(mocks.push).toHaveBeenCalledWith('/login');
  });

  it('validates email tokens and confirms a valid verification link', async () => {
    const user = userEvent.setup();
    const invalid = render(<VerifyEmail token={null} />);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    invalid.unmount();
    mocks.authRequest.mockRejectedValueOnce('unexpected verification failure');
    render(<VerifyEmail token={'b'.repeat(43)} />);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText(/Your email is verified/)).toBeInTheDocument();
  });

  it('signs out and exposes a failed sign-out request', async () => {
    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/login'));
    expect(mocks.refresh).toHaveBeenCalled();
    mocks.sessionRequest.mockRejectedValueOnce(new Error('Session unavailable.'));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session unavailable.');
    mocks.sessionRequest.mockRejectedValueOnce('unexpected sign-out failure');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign out could not be completed.');
  });

  it('loads tenant choices and changes the active tenant', async () => {
    const user = userEvent.setup();
    mocks.sessionRead.mockResolvedValue({
      activeTenantId: null,
      tenants: [
        { tenantId: '11111111-1111-4111-8111-111111111111', tenantName: 'Alpha' },
        { tenantId: '22222222-2222-4222-8222-222222222222', tenantName: 'Beta' },
      ],
    });
    render(<TenantSwitcher />);
    const select = await screen.findByRole('combobox', { name: 'Organisation' });
    await user.selectOptions(select, '22222222-2222-4222-8222-222222222222');
    await waitFor(() =>
      expect(mocks.sessionRequest).toHaveBeenCalledWith('/auth/tenant', 'POST', {
        tenantId: '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(mocks.reloadCurrentPage).toHaveBeenCalledOnce();
  });

  it('shows the active organisation without a switch control for one tenant', async () => {
    mocks.sessionRead.mockResolvedValueOnce({
      activeTenantId: '11111111-1111-4111-8111-111111111111',
      tenants: [{ tenantId: '11111111-1111-4111-8111-111111111111', tenantName: 'Alpha' }],
    });
    const view = render(<TenantSwitcher />);
    await waitFor(() => expect(mocks.sessionRead).toHaveBeenCalled());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Active organisation')).toHaveTextContent('Alpha');
    view.unmount();
    mocks.sessionRead.mockRejectedValueOnce(new Error('Could not load tenants.'));
    render(<TenantSwitcher />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tenants.');
  });

  it('uses safe fallback messages when API operations reject without Error objects', async () => {
    const user = userEvent.setup();
    mocks.authRequest.mockRejectedValueOnce('unexpected login failure');
    const loginView = render(<LoginForm />);
    await user.type(screen.getByLabelText('Email address'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in failed. Try again.');
    loginView.unmount();

    mocks.sessionRead.mockResolvedValueOnce({
      activeTenantId: '11111111-1111-4111-8111-111111111111',
      tenants: [
        { tenantId: '11111111-1111-4111-8111-111111111111', tenantName: 'Alpha' },
        { tenantId: '22222222-2222-4222-8222-222222222222', tenantName: 'Beta' },
      ],
    });
    mocks.sessionRequest.mockRejectedValueOnce('unexpected tenant switch failure');
    const view = render(<TenantSwitcher />);
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Organisation' }),
      '22222222-2222-4222-8222-222222222222',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Organisation could not be changed.',
    );
    expect(mocks.reloadCurrentPage).not.toHaveBeenCalled();
    view.unmount();
  });

  it('previews an invitation, registers an invited account, and continues through sign-in', async () => {
    const user = userEvent.setup();
    const token = 'c'.repeat(43);
    mocks.authRequest
      .mockResolvedValueOnce({
        tenantName: 'Atlas',
        inviterEmail: 'owner@example.test',
        roleName: 'Member',
        email: 'invitee@example.test',
        organisationNameIsSelfDeclared: true,
      })
      .mockResolvedValueOnce({
        accepted: true,
        tenantId: '11111111-1111-4111-8111-111111111111',
        signInRequired: true,
      });
    render(<InvitationForm token={token} />);
    expect(await screen.findByText('Atlas')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Full name'), 'Invitee');
    await user.type(screen.getByLabelText('Create a password'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to accept' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'invitee@example.test');
    await user.type(screen.getByLabelText('Password'), 'existing password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(mocks.sessionRequest).toHaveBeenCalledWith('/auth/tenant', 'POST', {
        tenantId: '11111111-1111-4111-8111-111111111111',
      }),
    );
  });

  it('handles a missing invitation token and an API sign-in-required response', async () => {
    const user = userEvent.setup();
    const missing = render(<InvitationForm token={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired');
    missing.unmount();

    const token = 'd'.repeat(43);
    mocks.authRequest
      .mockResolvedValueOnce({
        tenantName: 'Atlas',
        inviterEmail: 'owner@example.test',
        roleName: 'Member',
        email: 'member@example.test',
        organisationNameIsSelfDeclared: true,
      })
      .mockRejectedValueOnce(new ApiClientError('sign_in_required', 'Sign in to accept.'));
    render(<InvitationForm token={token} />);
    await screen.findByText('Atlas');
    await user.type(screen.getByLabelText('Full name'), 'Member');
    await user.type(screen.getByLabelText('Create a password'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to accept' })).toBeInTheDocument();
  });

  it('shows a safe invitation registration failure', async () => {
    const user = userEvent.setup();
    mocks.authRequest
      .mockResolvedValueOnce({
        tenantName: 'Atlas',
        inviterEmail: 'owner@example.test',
        roleName: 'Member',
        email: 'member@example.test',
        organisationNameIsSelfDeclared: true,
      })
      .mockRejectedValueOnce(new Error('This invitation is no longer valid.'));
    render(<InvitationForm token={'e'.repeat(43)} />);
    await screen.findByText('Atlas');
    await user.type(screen.getByLabelText('Full name'), 'Member');
    await user.type(screen.getByLabelText('Create a password'), 'a sufficiently long password');
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation is no longer valid.',
    );
  });

  it('loads pending invitations, revokes one, and handles load and revoke errors', async () => {
    const user = userEvent.setup();
    const invite = {
      invitationId: '11111111-1111-4111-8111-111111111111',
      email: 'member@example.test',
      roleKey: 'deal_viewer',
      createdAt: '2026-10-01T00:00:00Z',
      expiresAt: '2026-10-08T00:00:00Z',
    };
    mocks.sessionRead
      .mockResolvedValueOnce({ invitations: [invite] })
      .mockResolvedValueOnce({ invitations: [] });
    const populated = render(<PendingInvitations />);
    expect(await screen.findByText('member@example.test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument();
    populated.unmount();

    mocks.sessionRead.mockRejectedValueOnce(new Error('Load failed.'));
    const failedLoad = render(<PendingInvitations />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Load failed.');
    failedLoad.unmount();

    mocks.sessionRead.mockResolvedValueOnce({ invitations: [invite] });
    mocks.sessionRequest.mockRejectedValueOnce('Revoke failed.');
    render(<PendingInvitations />);
    await screen.findAllByText('member@example.test');
    const buttons = screen.getAllByRole('button', { name: 'Revoke' });
    await user.click(buttons[buttons.length - 1]!);
    expect(await screen.findAllByRole('alert')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ textContent: 'The invitation could not be revoked.' }),
      ]),
    );
  });
});
