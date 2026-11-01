import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../auth', () => ({
  ProfileAvatar: ({ children }: { readonly children: ReactNode }) => (
    <div>
      <button aria-label="Account menu for Example User">Account</button>
      <div hidden>{children}</div>
    </div>
  ),
  SignOutButton: () => <button>Sign out</button>,
  TenantSwitcher: () => <div>Organisation</div>,
}));
vi.mock('../notifications', () => ({
  NotificationBell: () => <button>Notifications</button>,
  requestOpenNotifications: vi.fn<() => void>(),
}));

import { AppShell } from './app-shell';
import { ThemeToggle } from './theme-toggle';

describe('AppShell', () => {
  it('uses the requested desktop and mobile navigation with the active page marked', () => {
    render(
      <AppShell currentPage="roles">
        <h1>Role management</h1>
      </AppShell>,
    );

    const navigation = screen.getAllByRole('navigation', { name: 'Workspace navigation' });
    expect(navigation).toHaveLength(2);
    for (const nav of navigation) {
      expect(within(nav).queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
      expect(nav.querySelector('a[href="/"]')).toHaveTextContent('My Work');
      expect(nav.querySelector('a[href="/pipeline"]')).toHaveTextContent('Pipeline');
      expect(nav.querySelector('a[href="/team"]')).toHaveTextContent('Team');
      expect(nav.querySelector('a[href="/team"]')).toHaveAttribute('aria-current', 'page');
      expect(nav.querySelector('a[href="/approvals"]')).toHaveTextContent('Approvals');
      expect(nav.querySelector('a[href="/settings"]')).not.toBeInTheDocument();
    }
    expect(screen.getByRole('complementary')).toHaveClass(
      'app-sidebar',
      'material-glass',
      'overflow-y-auto',
    );
    expect(screen.getByRole('complementary').parentElement).toHaveClass(
      'h-svh',
      'overflow-hidden',
      'lg:grid-cols-[15rem_minmax(0,1fr)]',
    );
    expect(screen.getByRole('banner')).toHaveClass('flex-none');
    expect(
      screen.getByRole('heading', { name: 'Role management' }).closest('.app-content-area'),
    ).toHaveClass('flex-1', 'overflow-y-auto');
    expect(screen.getByRole('heading', { name: 'Role management' })).toBeVisible();
  });

  it('keeps organisation and account actions in the shared top bar', () => {
    render(
      <AppShell currentPage="pipeline">
        <h1>Deal pipeline</h1>
      </AppShell>,
    );

    expect(screen.queryByText('Investment pipeline')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveClass('app-topbar', 'material-glass');
    expect(screen.getByRole('banner')).toHaveClass('grid-cols-[minmax(0,1fr)_auto]');
    expect(screen.getAllByText('Organisation')[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Account menu for Example User' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible();
    expect(screen.getByLabelText('Open notifications', { selector: 'button' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out', hidden: true })).toBeInTheDocument();
  });

  it('switches the theme and saves the preference for the next visit', async () => {
    document.documentElement.classList.remove('dark');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(document.cookie).toContain('theme=dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveTextContent(
      'Light mode',
    );
  });
});
