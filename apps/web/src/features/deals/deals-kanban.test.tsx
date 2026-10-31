import type { DealListResponse, Stage } from '@dpt/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DealsKanban } from './deals-kanban';

const icDeal: DealListResponse['items'][number] = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Northstar Systems',
  stage: 'ic_review',
  version: 1,
  sector: 'Technology',
  amount: '123456',
  currency: 'ZAR',
  expected_close_date: '2027-03-31',
  expected_close_time: null,
  created_at: '2026-10-28T10:00:00+00:00',
};

function dataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    getData: (key: string) => values.get(key) ?? '',
    setData: (key: string, value: string) => values.set(key, value),
  };
}

describe('DealsKanban', () => {
  it('places Passed after Closed and labels it as an outcome', () => {
    render(
      <DealsKanban
        deals={[icDeal]}
        disabled={false}
        onInvalidMove={vi.fn<(message: string) => void>()}
        onMove={vi.fn<(dealId: string, stage: Stage) => void>()}
      />,
    );
    const sections = screen
      .getAllByRole('region')
      .filter((region) => region.getAttribute('aria-label')?.endsWith('deals'));
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
      'Sourcing stage, 0 deals',
      'Screening stage, 0 deals',
      'Due Diligence stage, 0 deals',
      'IC Review stage, 1 deals',
      'Signed stage, 0 deals',
      'Closed stage, 0 deals',
      'Passed stage, 0 deals',
    ]);
    expect(screen.getByRole('heading', { name: 'Passed · outcome' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'IC Review stage, 1 deals' })).getByText(
        'Northstar Systems',
      ),
    ).toBeInTheDocument();
  });

  it('explains why IC Review cannot be dragged directly to Signed or Closed', () => {
    const onInvalidMove = vi.fn<(message: string) => void>();
    render(
      <DealsKanban
        deals={[icDeal]}
        disabled={false}
        onInvalidMove={onInvalidMove}
        onMove={vi.fn<(dealId: string, stage: Stage) => void>()}
      />,
    );
    const card = screen.getByText('Northstar Systems').closest('article');
    const signed = screen.getByRole('region', { name: 'Signed stage, 0 deals' });
    const closed = screen.getByRole('region', { name: 'Closed stage, 0 deals' });
    const transfer = dataTransfer();

    expect(card).not.toBeNull();
    fireEvent.dragStart(card!, { dataTransfer: transfer });
    fireEvent.dragOver(signed, { dataTransfer: transfer });
    expect(
      screen.getByText('An approved IC quorum moves this deal to Signed.'),
    ).toBeInTheDocument();
    fireEvent.dragOver(closed, { dataTransfer: transfer });
    expect(
      screen.getByText('Approve the IC review first, then move the Signed deal to Closed.'),
    ).toBeInTheDocument();
    fireEvent.drop(closed, { dataTransfer: transfer });
    expect(onInvalidMove).toHaveBeenCalledWith(
      'Approve the IC review first, then move the Signed deal to Closed.',
    );
  });
});
