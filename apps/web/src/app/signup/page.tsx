import type { Metadata } from 'next';

import { AuthShell, SignupForm } from '../../features/auth';

export const metadata: Metadata = { title: 'Create account | Deal Pipeline Tracker' };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Start a secure deal pipeline for your organisation. You’ll verify your work email before creating any organisation data."
    >
      <SignupForm />
    </AuthShell>
  );
}
