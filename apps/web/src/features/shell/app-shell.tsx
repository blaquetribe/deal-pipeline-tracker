import Link from 'next/link';
import type { ReactNode } from 'react';

import { ProfileAvatar, SignOutButton, TenantSwitcher } from '../auth';
import { NotificationBell } from '../notifications';

type AppPage = 'pipeline' | 'roles';

const navigation = [
  { href: '/', label: 'Pipeline', page: 'pipeline' },
  { href: '/roles', label: 'Roles', page: 'roles' },
] as const;

function PrimaryLinks({ currentPage }: { readonly currentPage: AppPage }) {
  return (
    <>
      {navigation.map(({ href, label, page }) => (
        <Link
          aria-current={currentPage === page ? 'page' : undefined}
          className={
            currentPage === page
              ? 'rounded-control bg-brand-soft px-3 py-2 text-sm font-medium text-brand-fg'
              : 'rounded-control px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-hover hover:text-fg'
          }
          href={href}
          key={page}
        >
          {label}
        </Link>
      ))}
    </>
  );
}

export function AppShell({
  currentPage,
  children,
}: {
  readonly currentPage: AppPage;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-8">
      <aside className="flex flex-col gap-5 border-b border-line-subtle pb-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:border-e lg:border-b-0 lg:pe-5 lg:pb-0">
        <Link aria-label="Deal Pipeline Tracker home" className="flex items-center gap-3" href="/">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-panel bg-brand text-sm font-bold tracking-wide text-fg-on-brand"
          >
            DP
          </span>
          <span className="text-base font-semibold tracking-tight">Deal Pipeline</span>
        </Link>
        <nav aria-label="Workspace navigation" className="hidden flex-col gap-1 lg:flex">
          <PrimaryLinks currentPage={currentPage} />
        </nav>
        <nav aria-label="Workspace navigation" className="flex gap-1 lg:hidden">
          <PrimaryLinks currentPage={currentPage} />
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle pb-5">
          <p className="text-sm font-medium text-fg-muted">
            {currentPage === 'pipeline' ? 'Investment pipeline' : 'Organisation settings'}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <TenantSwitcher />
            <NotificationBell />
            <ProfileAvatar />
            <SignOutButton />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
