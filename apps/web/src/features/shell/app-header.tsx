import Link from 'next/link';

import { ProfileAvatar, SignOutButton, TenantSwitcher } from '../auth';
import { NotificationBell } from '../notifications';

type AppPage = 'pipeline' | 'roles';

export function AppHeader({ currentPage }: { readonly currentPage: AppPage }) {
  return (
    <header className="mb-8 flex flex-col gap-5 border-b border-line-subtle pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Link aria-label="Deal Pipeline Tracker home" className="flex items-center gap-3" href="/">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-panel bg-brand text-sm font-bold tracking-wide text-fg-on-brand"
          >
            DP
          </span>
          <span className="text-base font-semibold tracking-tight">Deal Pipeline</span>
        </Link>
        <nav aria-label="Primary navigation" className="flex items-center gap-1">
          <Link
            aria-current={currentPage === 'pipeline' ? 'page' : undefined}
            className={
              currentPage === 'pipeline'
                ? 'rounded-control bg-brand-soft px-3 py-2 text-sm font-medium text-brand-fg'
                : 'rounded-control px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg'
            }
            href="/"
          >
            Pipeline
          </Link>
          <Link
            aria-current={currentPage === 'roles' ? 'page' : undefined}
            className={
              currentPage === 'roles'
                ? 'rounded-control bg-brand-soft px-3 py-2 text-sm font-medium text-brand-fg'
                : 'rounded-control px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg'
            }
            href="/roles"
          >
            Roles
          </Link>
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <TenantSwitcher />
        <NotificationBell />
        <ProfileAvatar />
        <SignOutButton />
      </div>
    </header>
  );
}
