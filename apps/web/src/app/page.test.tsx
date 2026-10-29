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
  DealsDashboard: () => (
    <section aria-labelledby="deals-title">
      <h2 id="deals-title">Deals</h2>
    </section>
  ),
}));

import HomePage from './page';

describe('HomePage', () => {
  it('has one level-one heading naming the product', () => {
    render(<HomePage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Deal pipeline' })).toBeVisible();
  });

  it('opens the deals dashboard', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Deals' })).toBeVisible();
  });
});
