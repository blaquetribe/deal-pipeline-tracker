import type { Metadata } from 'next';

import { AuthShell, ResetRequestForm } from '../../features/auth';

export const metadata: Metadata = { title: 'Reset password | Deal Pipeline Tracker' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your email address. If an eligible account exists, we’ll send a reset link."
    >
      <ResetRequestForm />
    </AuthShell>
  );
}
