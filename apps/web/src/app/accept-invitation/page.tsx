import type { Metadata } from 'next';

import { AuthShell, InvitationForm } from '../../features/auth';

export const metadata: Metadata = { title: 'Accept invitation | Deal Pipeline Tracker' };

export default async function AcceptInvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  return (
    <AuthShell
      title="You’re invited"
      description="Review the invitation, then create an account or sign in with the invited email."
    >
      <InvitationForm token={token} />
    </AuthShell>
  );
}
