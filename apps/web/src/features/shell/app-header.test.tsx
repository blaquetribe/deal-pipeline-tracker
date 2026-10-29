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

import { AppHeader } from './app-header';

describe('AppHeader', () => {
  it('marks the active primary navigation item', () => {
    render(<AppHeader currentPage="roles" />);

    expect(screen.getByRole('link', { name: 'Roles' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Pipeline' })).not.toHaveAttribute('aria-current');
  });

  it('keeps shared account actions available on every protected page', () => {
    render(<AppHeader currentPage="pipeline" />);

    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
