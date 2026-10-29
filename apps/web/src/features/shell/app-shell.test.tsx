import { render, screen } from '@testing-library/react';
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
  ProfileAvatar: () => <div>Profile</div>,
  SignOutButton: () => <button>Sign out</button>,
  TenantSwitcher: () => <div>Organisation</div>,
}));
vi.mock('../notifications', () => ({ NotificationBell: () => <button>Notifications</button> }));

import { AppShell } from './app-shell';

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
      expect(
        screen
          .getAllByRole('link', { name: 'Roles' })
          .some((link) => nav.contains(link) && link.getAttribute('aria-current') === 'page'),
      ).toBe(true);
      expect(nav.querySelector('a[href="/"]')).toHaveTextContent('Pipeline');
    }
    expect(screen.getByRole('complementary')).toHaveClass('material-glass');
    expect(screen.getByRole('heading', { name: 'Role management' })).toBeVisible();
  });

  it('keeps organisation and account actions in the shared top bar', () => {
    render(
      <AppShell currentPage="pipeline">
        <h1>Deal pipeline</h1>
      </AppShell>,
    );

    expect(screen.getByText('Investment pipeline')).toBeVisible();
    expect(screen.getByText('Investment pipeline').closest('header')).toHaveClass('material-glass');
    expect(screen.getByText('Organisation')).toBeVisible();
    expect(screen.getByText('Profile')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
