import type { Metadata } from 'next';

import { AuthShell, ResetPasswordForm } from '../../features/auth';

export const metadata: Metadata = { title: 'Choose a new password | Deal Pipeline Tracker' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  return (
    <AuthShell
      title="Choose a new password"
      description="This one-time link expires after one hour."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
