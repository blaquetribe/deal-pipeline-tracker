import type { Metadata } from 'next';

import { AuthShell, LoginForm } from '../../features/auth';

export const metadata: Metadata = { title: 'Sign in | Deal Pipeline Tracker' };

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" description="Access your organisation’s deal pipeline.">
      <LoginForm />
    </AuthShell>
  );
}
