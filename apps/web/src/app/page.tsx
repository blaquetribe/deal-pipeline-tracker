import { SignOutButton, TenantSwitcher } from '../features/auth';
import { DealsDashboard } from '../features/deals';

export default function HomePage() {
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Deal Pipeline Tracker</h1>
          <p className="mt-2 text-fg-muted">Your organisation’s deal pipeline.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <TenantSwitcher />
          <SignOutButton />
        </div>
      </header>
      <DealsDashboard />
    </>
  );
}
