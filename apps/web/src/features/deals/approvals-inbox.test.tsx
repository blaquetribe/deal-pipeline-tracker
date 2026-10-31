import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readDeals: vi.fn<(query: URLSearchParams) => Promise<unknown>>(),
  readStatus: vi.fn<(dealId: string) => Promise<unknown>>(),
}));
vi.mock('./api', () => ({
  readDeals: mocks.readDeals,
  readDealApprovalStatus: mocks.readStatus,
}));

import { ApprovalsInbox } from './approvals-inbox';

const deal = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Asterion Renewable Storage',
  stage: 'ic_review' as const,
  version: 3,
  sector: 'Energy',
  amount: '54000000000',
  currency: 'ZAR',
  expected_close_date: '2026-11-30',
  expected_close_time: null,
  created_at: '2026-10-30T12:00:00.000Z',
};

describe('ApprovalsInbox', () => {
  beforeEach(() => {
    mocks.readDeals.mockReset().mockResolvedValue({ total: 1, items: [deal] });
    mocks.readStatus.mockReset().mockResolvedValue({
      requestId: 'bbbbbbbb-0000-4000-8000-000000000001',
      status: 'pending',
      requiredApprovals: 2,
      configuredApprovals: 2,
      approvedCount: 1,
      pendingCount: 1,
      rejectedCount: 0,
      currentUserDecision: null,
      delegatedSlots: [],
      canRequest: false,
      canDecide: true,
      canConfigure: false,
      canManageAbsence: false,
      canReassign: false,
    });
  });

  it('shows a pending request that needs the current user and links to its deal', async () => {
    render(<ApprovalsInbox />);
    expect(
      await screen.findByRole('heading', { name: 'Asterion Renewable Storage' }),
    ).toBeVisible();
    expect(screen.getByText('Your decision needed')).toBeVisible();
    expect(screen.getByText('1 approved · 1 pending · 0 rejected · 2 required')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open review' })).toHaveAttribute(
      'href',
      `/deals/${deal.id}`,
    );
    expect(mocks.readDeals).toHaveBeenCalledTimes(1);
    const query = mocks.readDeals.mock.calls[0]?.[0];
    expect(query?.get('stage')).toBe('ic_review');
  });

  it('explains that an authorized requester must start an unrequested deal', async () => {
    mocks.readStatus.mockResolvedValueOnce({
      requestId: null,
      status: null,
      requiredApprovals: null,
      configuredApprovals: 1,
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      currentUserDecision: null,
      delegatedSlots: [],
      canRequest: false,
      canDecide: false,
      canConfigure: true,
      canManageAbsence: false,
      canReassign: false,
    });
    render(<ApprovalsInbox />);

    expect(
      await screen.findByText(
        'No request yet. A Deal Lead or another authorized requester must submit it from the deal.',
      ),
    ).toBeVisible();
  });

  it('tells an authorized requester they can start approval from the deal', async () => {
    mocks.readStatus.mockResolvedValueOnce({
      requestId: null,
      status: null,
      requiredApprovals: null,
      configuredApprovals: 1,
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      currentUserDecision: null,
      delegatedSlots: [],
      canRequest: true,
      canDecide: false,
      canConfigure: false,
      canManageAbsence: false,
      canReassign: false,
    });
    render(<ApprovalsInbox />);

    expect(
      await screen.findByText('No request yet. Open the deal to request IC approval.'),
    ).toBeVisible();
  });

  it('explains when there are no deals in IC Review', async () => {
    mocks.readDeals.mockResolvedValueOnce({ total: 0, items: [] });
    render(<ApprovalsInbox />);
    expect(
      await screen.findByRole('heading', { name: 'No deals awaiting IC review' }),
    ).toBeVisible();
    expect(screen.getByText(/actions available to your role/)).toBeVisible();
  });

  it('shows a useful error when the queue cannot be loaded', async () => {
    mocks.readDeals.mockRejectedValueOnce(new Error('The queue could not be loaded.'));
    render(<ApprovalsInbox />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The queue could not be loaded.');
  });
});
