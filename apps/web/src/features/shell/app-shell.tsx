import Link from 'next/link';
import type { ReactNode } from 'react';

import { ProfileAvatar, SignOutButton, TenantSwitcher } from '../auth';
import { NotificationBell } from '../notifications';
import { Icon } from '../ui/icon';
import { OpenNotificationsAction } from './open-notifications-action';
import { ThemeToggle } from './theme-toggle';

type AppPage = 'my-work' | 'pipeline' | 'team' | 'approvals' | 'roles' | 'settings';

const navigation = [
  { href: '/', label: 'My Work', page: 'my-work', icon: 'work' },
  { href: '/pipeline', label: 'Pipeline', page: 'pipeline', icon: 'pipeline' },
  { href: '/team', label: 'Team', page: 'team', icon: 'team' },
  { href: '/approvals', label: 'Approvals', page: 'approvals', icon: 'approval' },
] as const;

function PrimaryLinks({ currentPage }: { readonly currentPage: AppPage }) {
  return (
    <>
      {navigation.map(({ href, label, page, icon }) => {
        const active = currentPage === page || (currentPage === 'roles' && page === 'team');
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={`app-nav-link ${active ? 'app-nav-link-active' : ''}`}
            href={href}
            key={page}
          >
            <Icon className="size-[1.125rem] shrink-0" name={icon} />
            {label}
          </Link>
        );
      })}
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
    <div className="-m-4 grid h-svh min-h-0 min-w-0 grid-cols-1 overflow-hidden bg-canvas sm:-m-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:-m-8">
      <aside className="app-sidebar material-glass hidden min-h-0 flex-col gap-5 overflow-y-auto overscroll-contain p-4 lg:flex">
        <Link
          aria-label="Deal Pipeline Tracker home"
          className="flex items-center gap-3 px-1 py-2"
          href="/"
        >
          <span
            aria-hidden="true"
            className="app-brand-mark grid size-10 shrink-0 place-items-center rounded-lg text-sm font-bold tracking-wide text-fg-on-brand"
          >
            DP
          </span>
          <span className="app-shell-title text-[0.95rem] font-semibold tracking-tight">
            Deal Pipeline
          </span>
        </Link>
        <p className="app-sidebar-eyebrow px-3 text-[0.68rem] font-semibold tracking-[0.14em] uppercase">
          Workspace
        </p>
        <nav aria-label="Workspace navigation" className="-mt-4 flex flex-col gap-1">
          <PrimaryLinks currentPage={currentPage} />
        </nav>
        <div className="app-sidebar-note mt-auto rounded-lg border p-3">
          <p className="text-xs font-semibold">Private workspace</p>
          <p className="mt-1 text-xs leading-relaxed">
            Deals and activity stay scoped to your organisation.
          </p>
        </div>
      </aside>

      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="app-topbar material-glass relative z-30 grid flex-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-x-0 border-t-0 px-4 py-2 sm:px-6 lg:gap-x-5 lg:px-8">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 lg:hidden">
            <span
              aria-hidden="true"
              className="app-brand-mark grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-fg-on-brand"
            >
              DP
            </span>
            <span className="truncate text-sm font-semibold text-fg">Deal Pipeline</span>
          </div>
          <div className="col-start-1 row-start-2 min-w-0 lg:col-start-1 lg:row-start-1">
            <TenantSwitcher />
          </div>
          <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-2">
            <NotificationBell compact />
            <ProfileAvatar compact>
              <OpenNotificationsAction />
              <Link className="account-menu-item" href="/settings">
                <Icon className="size-4" name="settings" />
                Settings
              </Link>
              <ThemeToggle />
              <SignOutButton />
            </ProfileAvatar>
          </div>
        </header>
        <nav
          aria-label="Workspace navigation"
          className="app-mobile-nav fixed inset-x-3 bottom-3 z-40 flex max-w-[calc(100vw-1.5rem)] gap-1 overflow-x-auto rounded-xl border p-1.5 lg:hidden"
        >
          <PrimaryLinks currentPage={currentPage} />
        </nav>
        <div className="app-content-area min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
