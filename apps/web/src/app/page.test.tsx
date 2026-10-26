import { STAGES } from '@dpt/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('has one level-one heading naming the product', () => {
    render(<HomePage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Deal Pipeline Tracker' })).toBeVisible();
  });

  it('lists every pipeline stage once, in order, as text', () => {
    render(<HomePage />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(STAGES.length);
    expect(items.map((item) => item.textContent)).toEqual([
      'Sourcing',
      'Screening',
      'Due Diligence',
      'IC Review',
      'Signed',
      'Closed',
      'Passed',
    ]);
  });
});
