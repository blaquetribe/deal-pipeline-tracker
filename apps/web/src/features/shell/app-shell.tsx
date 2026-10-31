import Link from 'next/link';
import type { ReactNode } from 'react';

import { ProfileAvatar, SignOutButton, TenantSwitcher } from '../auth';
import { NotificationBell } from '../notifications';
import { ThemeToggle } from './theme-toggle';

type AppPage = 'my-work' | 'pipeline' | 'team' | 'approvals' | 'roles' | 'settings';

const navigation = [
  { href: '/', label: 'My Work', page: 'my-work' },
  { href: '/pipeline', label: 'Pipeline', page: 'pipeline' },
  { href: '/team', label: 'Team', page: 'team' },
  { href: '/approvals', label: 'Approvals', page: 'approvals' },
  { href: '/settings', label: 'Settings', page: 'settings' },
] as const;

const pageDescriptions: Record<AppPage, string> = {
  'my-work': 'Your workspace',
  pipeline: 'Investment pipeline',
  team: 'Team and invitations',
  approvals: 'IC approval queue',
  roles: 'Roles and permissions',
  settings: 'Organisation settings',
};

function PrimaryLinks({ currentPage }: { readonly currentPage: AppPage }) {
  return (
    <>
      {navigation.map(({ href, label, page }) => (
        <Link
          aria-current={currentPage === page ? 'page' : undefined}
          className={`app-nav-link ${currentPage === page ? 'app-nav-link-active' : ''}`}
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
    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-8">
      <aside className="app-sidebar material-glass flex flex-col gap-5 rounded-panel p-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:self-start">
        <Link aria-label="Deal Pipeline Tracker home" className="flex items-center gap-3" href="/">
          <span
            aria-hidden="true"
            className="app-brand-mark grid size-11 shrink-0 place-items-center rounded-panel text-sm font-bold tracking-wide text-fg-on-brand"
          >
            DP
          </span>
          <span className="text-base font-semibold tracking-tight text-white">Deal Pipeline</span>
        </Link>
        <nav aria-label="Workspace navigation" className="hidden flex-col gap-1 lg:flex">
          <PrimaryLinks currentPage={currentPage} />
        </nav>
        <nav
          aria-label="Workspace navigation"
          className="flex max-w-full gap-1 overflow-x-auto lg:hidden"
        >
          <PrimaryLinks currentPage={currentPage} />
        </nav>
        <div className="mt-auto hidden rounded-panel border border-white/10 bg-white/5 p-3 lg:block">
          <p className="text-xs font-semibold text-white">Private workspace</p>
          <p className="mt-1 text-xs leading-relaxed text-white/70">
            Deals and activity stay scoped to your organisation.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="app-topbar material-glass mb-8 flex flex-wrap items-center justify-between gap-4 rounded-panel p-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-brand-fg uppercase">
              Deal Pipeline Tracker
            </p>
            <p className="mt-1 text-sm font-medium text-fg-muted">
              {pageDescriptions[currentPage]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TenantSwitcher />
            <ThemeToggle />
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
