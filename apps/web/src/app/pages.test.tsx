import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const notFound = vi.hoisted(() =>
  vi.fn<() => never>(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('../features/auth', () => ({
  AuthShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
  InvitationForm: ({ token }: { token: string | null }) => (
    <p>Invitation token: {token ?? 'missing'}</p>
  ),
  LoginForm: () => <p>Login form</p>,
  Onboarding: () => <p>Onboarding form</p>,
  ProfileAvatar: () => null,
  ResendForm: () => <p>Resend form</p>,
  ResetPasswordForm: ({ token }: { token: string | null }) => (
    <p>Reset token: {token ?? 'missing'}</p>
  ),
  ResetRequestForm: () => <p>Reset request form</p>,
  SignOutButton: () => <button>Sign out</button>,
  SignupForm: () => <p>Signup form</p>,
  TenantSwitcher: () => <p>Tenant switcher</p>,
  VerifyEmail: ({ token }: { token: string | null }) => <p>Verify token: {token ?? 'missing'}</p>,
}));
vi.mock('../features/deals', () => ({
  DealDetail: ({ dealId }: { dealId: string }) => <p>Deal id: {dealId}</p>,
  DealsDashboard: () => <p>Deals dashboard</p>,
}));
vi.mock('../features/roles', () => ({ RoleManagement: () => <p>Role management component</p> }));

import AcceptInvitationPage from './accept-invitation/page';
import CheckEmailPage from './check-email/page';
import DealPage from './deals/[dealId]/page';
import ForgotPasswordPage from './forgot-password/page';
import LoginPage from './login/page';
import OnboardingStepPage from './onboarding/[step]/page';
import OnboardingPage from './onboarding/page';
import HomePage from './page';
import ResetPasswordPage from './reset-password/page';
import RolesPage from './roles/page';
import SignupPage from './signup/page';
import VerifyEmailPage from './verify-email/page';

describe('Next page wrappers', () => {
  it('passes only string invitation, verification, and reset tokens into forms', async () => {
    render(
      await AcceptInvitationPage({ searchParams: Promise.resolve({ token: 'invite-token' }) }),
    );
    expect(screen.getByText('Invitation token: invite-token')).toBeInTheDocument();
    const invitation = render(await AcceptInvitationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Invitation token: missing')).toBeInTheDocument();
    invitation.unmount();

    render(await VerifyEmailPage({ searchParams: Promise.resolve({ token: ['a', 'b'] }) }));
    expect(screen.getByText('Verify token: missing')).toBeInTheDocument();
    const verification = render(
      await VerifyEmailPage({ searchParams: Promise.resolve({ token: 'verified-token' }) }),
    );
    expect(screen.getByText('Verify token: verified-token')).toBeInTheDocument();
    verification.unmount();

    render(await ResetPasswordPage({ searchParams: Promise.resolve({ token: 'reset-token' }) }));
    expect(screen.getByText('Reset token: reset-token')).toBeInTheDocument();
    render(await ResetPasswordPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Reset token: missing')).toBeInTheDocument();
  });

  it('renders the synchronous auth pages with their expected heading', () => {
    for (const [Page, heading] of [
      [CheckEmailPage, 'Check your inbox'],
      [ForgotPasswordPage, 'Reset your password'],
      [LoginPage, 'Sign in'],
      [SignupPage, 'Create your account'],
    ] as const) {
      const view = render(<Page />);
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('renders the home, onboarding and valid onboarding-step pages', async () => {
    const home = render(<HomePage />);
    expect(screen.getByText('Deals dashboard')).toBeInTheDocument();
    home.unmount();
    const onboarding = render(<OnboardingPage />);
    expect(screen.getByText('Onboarding form')).toBeInTheDocument();
    onboarding.unmount();
    render(await OnboardingStepPage({ params: Promise.resolve({ step: 'profile' }) }));
    expect(screen.getByText('Onboarding form')).toBeInTheDocument();
    await expect(
      OnboardingStepPage({ params: Promise.resolve({ step: 'unknown' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('renders the deal header and binds its awaited route id', async () => {
    render(await DealPage({ params: Promise.resolve({ dealId: 'deal-42' }) }));
    expect(screen.getByText('Deal id: deal-42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('renders the role management page', () => {
    render(<RolesPage />);
    expect(screen.getByRole('heading', { name: 'Role management' })).toBeInTheDocument();
    expect(screen.getByText('Role management component')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to pipeline' })).toHaveAttribute('href', '/');
  });
});
