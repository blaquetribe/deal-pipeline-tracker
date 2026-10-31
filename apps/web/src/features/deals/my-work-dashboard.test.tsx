import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readAuthSession: vi.fn<() => Promise<unknown>>(),
  readNotifications: vi.fn<() => Promise<unknown>>(),
  readMyWork: vi.fn<(query: URLSearchParams) => Promise<unknown>>(),
  readDeals: vi.fn<(query: URLSearchParams) => Promise<unknown>>(),
  readDealApprovalStatus: vi.fn<(dealId: string) => Promise<unknown>>(),
}));

vi.mock('../auth', () => ({ readAuthSession: mocks.readAuthSession }));
vi.mock('../notifications', () => ({ readNotifications: mocks.readNotifications }));
vi.mock('./api', () => ({
  readMyWork: mocks.readMyWork,
  readDeals: mocks.readDeals,
  readDealApprovalStatus: mocks.readDealApprovalStatus,
}));

import { MyWorkDashboard } from './my-work-dashboard';

const energyDeal = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Asterion Renewable Storage',
  stage: 'due_diligence' as const,
  version: 3,
  sector: 'Energy',
  amount: '54000000000',
  currency: 'ZAR',
  expected_close_date: '2026-11-30',
  expected_close_time: null,
  created_at: '2026-10-30T12:00:00.000Z',
  assignment_role: 'lead' as const,
};

const passedDeal = {
  ...energyDeal,
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: 'Passed opportunity',
  stage: 'passed' as const,
  assignment_role: 'member' as const,
};

describe('MyWorkDashboard', () => {
  beforeEach(() => {
    mocks.readAuthSession.mockReset().mockResolvedValue({
      user: {
        id: 'cccccccc-0000-4000-8000-000000000001',
        email: 'amara@example.test',
        fullName: 'Amara Ndlovu',
      },
      tenantId: 'dddddddd-0000-4000-8000-000000000001',
      csrfToken: 'csrf',
    });
    mocks.readNotifications.mockReset().mockResolvedValue([
      {
        id: 'bbbbbbbb-0000-4000-8000-000000000001',
        kind: 'approval_sla_escalation',
        payload: {
          dealName: 'IC decision',
          message: 'Your review is overdue.',
          href: '/deals/aaaaaaaa-0000-4000-8000-000000000001',
        },
        created_at: '2026-10-31T08:00:00.000Z',
        read_at: null,
      },
    ]);
    mocks.readMyWork
      .mockReset()
      .mockResolvedValue({ total: 2, activeCount: 1, items: [energyDeal, passedDeal] });
    mocks.readDeals
      .mockReset()
      .mockResolvedValue({ total: 1, items: [{ ...energyDeal, stage: 'ic_review' }] });
    mocks.readDealApprovalStatus.mockReset().mockResolvedValue({
      requestId: 'eeeeeeee-0000-4000-8000-000000000001',
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

  it('personalizes the workspace with assigned work, stage progress, decisions, and updates', async () => {
    render(<MyWorkDashboard />);
    const welcome = await screen.findByRole('heading', { name: 'Welcome back, Amara' });
    expect(welcome).toBeVisible();
    expect(welcome).toHaveClass('text-fg');
    expect(
      within(screen.getByRole('region', { name: 'Assigned to you' })).getByRole('heading', {
        name: 'Asterion Renewable Storage',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('progressbar', { name: 'Asterion Renewable Storage progress' }),
    ).toHaveAttribute('aria-valuetext', 'Stage 3 of 6: Due Diligence');
    expect(screen.getByText('Passed · this deal is no longer progressing.')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Waiting on your review' })).getByRole('heading', {
        name: 'Asterion Renewable Storage',
      }),
    ).toBeVisible();
    expect(screen.getByText('Your review is overdue.')).toBeVisible();
    expect(screen.getByText('Unread updates').parentElement).toHaveTextContent('1');
  });

  it('shows an empty assigned-work state and does not invent progress for Passed deals', async () => {
    mocks.readMyWork.mockResolvedValueOnce({ total: 0, activeCount: 0, items: [] });
    mocks.readDeals.mockResolvedValueOnce({ total: 0, items: [] });
    render(<MyWorkDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'No deals assigned to you yet' }),
    ).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('waits for organisation selection instead of showing failed or empty tenant data', async () => {
    mocks.readAuthSession.mockResolvedValueOnce({
      user: {
        id: 'cccccccc-0000-4000-8000-000000000001',
        email: 'amara@example.test',
        fullName: 'Amara Ndlovu',
      },
      tenantId: null,
      csrfToken: 'csrf',
    });
    render(<MyWorkDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Choose an organisation to load your work' }),
    ).toBeVisible();
    expect(mocks.readMyWork).not.toHaveBeenCalled();
    expect(mocks.readDeals).not.toHaveBeenCalled();
    expect(mocks.readNotifications).not.toHaveBeenCalled();
  });

  it('keeps the rest of the workspace useful when one data source fails', async () => {
    mocks.readMyWork.mockRejectedValueOnce(new Error('Database error detail'));
    render(<MyWorkDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your assigned deals could not be loaded.',
    );
    expect(screen.queryByText('Database error detail')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back, Amara' })).toBeVisible();
  });
});
