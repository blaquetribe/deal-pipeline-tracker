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
  created_by: { userId: 'bbbbbbbb-0000-4000-8000-000000000001', displayName: 'Amara Ndlovu' },
  updated_at: '2026-10-28T10:00:00+00:00',
  updated_by: null,
  assigned_to: [],
  approved_by: [],
  rejected: false,
  rejection_reason: null,
  approval: {
    requestId: null,
    status: null,
    requestedBy: null,
    approvers: [],
    rejectionReason: null,
    approvedBy: [],
    rejected: false,
  },
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
      screen.getByRole('region', { name: /Scroll horizontally to see every stage/ }),
    ).toHaveAttribute('tabindex', '0');
    expect(
      within(screen.getByRole('region', { name: 'IC Review stage, 1 deals' })).getByText(
        'Northstar Systems',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Created by Amara Ndlovu')).toBeVisible();
  });

  it('shows assigned, approved, and rejected audit details on a board card', () => {
    const auditedDeal: DealListResponse['items'][number] = {
      ...icDeal,
      assigned_to: [
        {
          userId: 'bbbbbbbb-0000-4000-8000-000000000002',
          displayName: null,
          role: 'lead',
        },
      ],
      approved_by: [
        { userId: 'bbbbbbbb-0000-4000-8000-000000000003', displayName: 'Naledi Khumalo' },
      ],
      rejected: true,
      rejection_reason: 'Quorum no longer reachable',
    };
    render(
      <DealsKanban
        deals={[auditedDeal]}
        disabled={false}
        onInvalidMove={vi.fn<(message: string) => void>()}
        onMove={vi.fn<(dealId: string, stage: Stage) => void>()}
      />,
    );

    expect(screen.getByText('Assigned: Unnamed (lead)')).toBeVisible();
    expect(screen.getByText('Approved by Naledi Khumalo')).toBeVisible();
    expect(screen.getByText('Rejected · Quorum no longer reachable')).toBeVisible();
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

  it('moves an eligible deal when dropped in the next stage', () => {
    const deal = { ...icDeal, stage: 'sourcing' as const };
    const onMove = vi.fn<(dealId: string, stage: Stage) => void>();
    const onInvalidMove = vi.fn<(message: string) => void>();
    render(
      <DealsKanban deals={[deal]} disabled={false} onInvalidMove={onInvalidMove} onMove={onMove} />,
    );
    const card = screen.getByText(deal.name).closest('article')!;
    const destination = screen.getByRole('region', { name: 'Screening stage, 0 deals' });
    const transfer = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(destination, { dataTransfer: transfer });
    expect(screen.getByText('Drop to move to Screening.')).toBeVisible();
    expect(transfer.dropEffect).toBe('move');
    fireEvent.drop(destination, { dataTransfer: transfer });
    expect(onMove).toHaveBeenCalledWith(deal.id, 'screening');
    expect(onInvalidMove).not.toHaveBeenCalled();
  });

  it('shows the exact fields required before progressing a deal', () => {
    const deal = {
      ...icDeal,
      stage: 'screening' as const,
      sector: null,
      amount: null,
      expected_close_date: null,
    };
    const onInvalidMove = vi.fn<(message: string) => void>();
    render(
      <DealsKanban
        deals={[deal]}
        disabled={false}
        onInvalidMove={onInvalidMove}
        onMove={vi.fn<(dealId: string, stage: Stage) => void>()}
      />,
    );
    const card = screen.getByText(deal.name).closest('article')!;
    const destination = screen.getByRole('region', { name: 'Due Diligence stage, 0 deals' });
    const transfer = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.dragOver(destination, { dataTransfer: transfer });
    expect(
      screen.getByText(
        'Add deal size and expected close date and sector before moving to Due Diligence.',
      ),
    ).toBeVisible();
    expect(transfer.dropEffect).toBe('none');
    fireEvent.drop(destination, { dataTransfer: transfer });
    expect(onInvalidMove).toHaveBeenCalledWith(
      'Add deal size and expected close date and sector before moving to Due Diligence.',
    );
  });
});
