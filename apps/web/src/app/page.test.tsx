import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth', () => ({
  ProfileAvatar: () => null,
  SignOutButton: () => null,
  TenantSwitcher: () => null,
}));
vi.mock('../features/shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('../features/deals', () => ({
  MyWorkDashboard: () => (
    <section>
      <h2>My assigned work</h2>
    </section>
  ),
}));

import HomePage from './page';

describe('HomePage', () => {
  it('has one level-one heading naming the product', () => {
    render(<HomePage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'My workspace' })).toBeVisible();
  });

  it('opens the signed-in user workspace', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 2, name: 'My assigned work' })).toBeVisible();
  });
});
