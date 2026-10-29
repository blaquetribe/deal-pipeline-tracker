import Link from 'next/link';

import { ProfileAvatar, SignOutButton, TenantSwitcher } from '../features/auth';
import { DealsDashboard } from '../features/deals';
import { NotificationBell } from '../features/notifications';

export default function HomePage() {
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Deal Pipeline Tracker</h1>
          <p className="mt-2 text-fg-muted">Your organisation’s deal pipeline.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ProfileAvatar />
          <TenantSwitcher />
          <Link className="text-sm text-brand-fg underline" href="/roles">
            Roles
          </Link>
          <NotificationBell />
          <SignOutButton />
        </div>
      </header>
      <DealsDashboard />
    </>
  );
}
