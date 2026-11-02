import type {
  CreateDealBody,
  DashboardSummary,
  DealListResponse,
  Stage,
  UpdateDealBody,
} from '@dpt/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  readDeals: vi.fn<(...args: [URLSearchParams]) => Promise<DealListResponse>>(),
  readDashboardSummary: vi.fn<() => Promise<DashboardSummary>>(),
  createDeal: vi.fn<(...args: [CreateDealBody]) => Promise<void>>(),
  moveDealStage: vi.fn<(...args: [string, Stage, number]) => Promise<void>>(),
  updateDeal: vi.fn<(...args: [string, UpdateDealBody]) => Promise<void>>(),
}));

vi.mock('./api', () => api);

import { DealsDashboard } from './deals-dashboard';

const deal = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Northstar Systems',
  stage: 'sourcing' as const,
  version: 1,
  sector: 'Technology',
  amount: '10000',
  currency: 'ZAR',
  expected_close_date: '2027-03-31',
  expected_close_time: null,
  created_at: '2026-10-28T10:00:00+00:00',
  created_by: null,
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

const summary: DashboardSummary = {
  serverNow: '2026-10-28T10:00:00+00:00',
  nextMidnightAt: '2026-10-28T21:00:00+00:00',
  timeZone: 'Africa/Johannesburg',
  windowDays: 60,
  pipelineByStage: [],
  totalsByCurrency: [],
  closingSoonCount: 0,
  closingSoon: [],
};

const closingDealMetadata = {
  created_by: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  api.readDeals.mockResolvedValue({ total: 1, items: [deal] });
  api.readDashboardSummary.mockResolvedValue(summary);
  api.createDeal.mockResolvedValue();
  api.moveDealStage.mockResolvedValue();
  api.updateDeal.mockResolvedValue();
});

afterEach(() => vi.useRealTimers());

describe('DealsDashboard interactions', () => {
  it('moves to the next result page and returns to the first page', async () => {
    api.readDeals.mockResolvedValue({ total: 30, items: [deal] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api.readDeals).toHaveBeenLastCalledWith(expect.any(URLSearchParams)),
    );
    expect([...api.readDeals.mock.lastCall![0].entries()]).toContainEqual(['offset', '25']);

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() =>
      expect([...api.readDeals.mock.lastCall![0].entries()]).toContainEqual(['offset', '0']),
    );
  });

  it('explains required deal fields before allowing a stage move', async () => {
    api.readDeals.mockResolvedValue({
      total: 1,
      items: [{ ...deal, sector: null, amount: null, expected_close_date: null }],
    });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    expect(screen.getByRole('button', { name: 'Move to…' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Move to Screening' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to…' }));

    expect(screen.getByText('Requires deal size and sector')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to Screening' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move to Passed' })).toBeEnabled();
    expect(api.moveDealStage).not.toHaveBeenCalled();
  });

  it('shows only legal moves and keeps approval-controlled Signed automatic', async () => {
    api.readDeals.mockResolvedValue({
      total: 1,
      items: [{ ...deal, stage: 'ic_review' }],
    });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Move to…' }));

    expect(screen.getByRole('button', { name: 'Move to Due Diligence' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move to Passed' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Move to Signed' })).not.toBeInTheDocument();
  });

  it('shows terminal stages without offering an invalid move', async () => {
    api.readDeals.mockResolvedValue({ total: 1, items: [{ ...deal, stage: 'closed' }] });
    render(<DealsDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    expect(screen.getByText('Final stage')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Move to/ })).not.toBeInTheDocument();
  });

  it('creates a deal with omitted optional fields and refreshes the list', async () => {
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Create deal' }));
    await user.type(screen.getByRole('textbox', { name: 'Deal name' }), 'New opportunity');
    const [createCurrency] = screen.getAllByRole('textbox', { name: 'Currency' });
    await user.clear(createCurrency!);
    await user.type(createCurrency!, 'USD');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));

    expect(await screen.findByText('Deal created.')).toBeInTheDocument();
    expect(api.createDeal).toHaveBeenCalledWith({
      name: 'New opportunity',
      sector: null,
      amount: null,
      currency: 'USD',
      expectedCloseDate: null,
    });
    expect(api.readDeals).toHaveBeenCalledTimes(2);
  });

  it('refreshes a minute countdown against the server clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    api.readDashboardSummary.mockResolvedValue({
      ...summary,
      closingSoonCount: 1,
      closingSoon: [
        {
          id: deal.id,
          name: deal.name,
          stage: 'sourcing',
          amount: deal.amount,
          currency: deal.currency,
          expectedCloseDate: '2026-10-28',
          expectedCloseTime: null,
          closesInDays: 0,
          closesAt: '2026-10-28T10:30:00.000Z',
          ...closingDealMetadata,
        },
      ],
    });

    render(<DealsDashboard />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getAllByRole('link', { name: deal.name })).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(api.readDashboardSummary).toHaveBeenCalledOnce();
  });

  it('refreshes at tenant midnight and marks urgent closing deals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    api.readDashboardSummary.mockResolvedValue({
      ...summary,
      nextMidnightAt: '2026-10-28T10:00:30.000Z',
      closingSoonCount: 1,
      closingSoon: [
        {
          id: deal.id,
          name: deal.name,
          stage: 'sourcing',
          amount: deal.amount,
          currency: deal.currency,
          expectedCloseDate: '2026-10-30',
          expectedCloseTime: null,
          closesInDays: 2,
          closesAt: null,
          ...closingDealMetadata,
        },
      ],
    });
    render(<DealsDashboard />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const countdown = screen.getByText('2 days left');
    expect(countdown.className).toContain('border-danger/40');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(api.readDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('shows a safe error when the stage transition is rejected', async () => {
    api.moveDealStage.mockRejectedValue(new Error('The transition is no longer available.'));
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('button', { name: 'Move to Screening' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The transition is no longer available.',
    );
    expect(screen.getByRole('row', { name: /Northstar Systems/ })).toBeVisible();
  });

  it('shows a safe error when saving an edited deal fails', async () => {
    api.updateDeal.mockRejectedValue(new Error('The deal changed. Reload and try again.'));
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Edit Northstar Systems' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Northstar Systems' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Deal name' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Deal name' }),
      'Northstar Updated',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The deal changed. Reload and try again.',
    );
    expect(api.updateDeal).toHaveBeenCalledWith(
      deal.id,
      expect.objectContaining({ expectedVersion: deal.version, name: 'Northstar Updated' }),
    );
  });
});
