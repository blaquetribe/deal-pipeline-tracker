import type { Metadata } from 'next';

import { AuthShell, ResendForm } from '../../features/auth';

export const metadata: Metadata = { title: 'Check your email | Deal Pipeline Tracker' };

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Check your inbox"
      description="If the address can be registered, a verification link will arrive shortly. The link is valid for 24 hours."
    >
      <section aria-labelledby="resend-heading" className="space-y-4">
        <h2 className="text-lg font-medium" id="resend-heading">
          Need another link?
        </h2>
        <ResendForm />
      </section>
    </AuthShell>
  );
}
