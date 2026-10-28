import type { Metadata } from 'next';

import { AuthShell, VerifyEmail } from '../../features/auth';

export const metadata: Metadata = { title: 'Verify email | Deal Pipeline Tracker' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  return (
    <AuthShell
      title="Verify your email"
      description="Confirm you control this email address before any organisation data is created."
    >
      <VerifyEmail token={token} />
    </AuthShell>
  );
}
