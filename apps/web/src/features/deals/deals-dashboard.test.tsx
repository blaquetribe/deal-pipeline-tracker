import type { DashboardSummary } from '@dpt/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DealsDashboard } from './deals-dashboard';

const deal = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Northstar Systems',
  stage: 'sourcing',
  version: 1,
  sector: 'Technology',
  amount: '123456789012345',
  currency: 'ZAR',
  expected_close_date: '2027-03-31',
  expected_close_time: '15:30:00',
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

const dashboardSummary: DashboardSummary = {
  serverNow: '2026-10-28T10:00:00+00:00',
  nextMidnightAt: '2026-10-28T21:00:00+00:00',
  timeZone: 'Africa/Johannesburg',
  windowDays: 60,
  pipelineByStage: [{ stage: 'sourcing', count: 1 }],
  totalsByCurrency: [{ currency: 'ZAR', amount: '123456789012345' }],
  closingSoonCount: 0,
  closingSoon: [],
};

const closingDealMetadata = {
  created_by: { userId: 'bbbbbbbb-0000-4000-8000-000000000001', displayName: 'Amara Ndlovu' },
  updated_at: '2026-10-28T10:00:00+00:00',
  updated_by: { userId: 'bbbbbbbb-0000-4000-8000-000000000002', displayName: 'Lerato Molefe' },
  assigned_to: [
    {
      userId: 'bbbbbbbb-0000-4000-8000-000000000003',
      displayName: 'Sibusiso Dlamini',
      role: 'lead' as const,
    },
  ],
  approved_by: [{ userId: 'bbbbbbbb-0000-4000-8000-000000000004', displayName: 'Naledi Khumalo' }],
  rejected: true,
  rejection_reason: 'Quorum no longer reachable',
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

function stubFetch(body: unknown, status = 200, summary = dashboardSummary) {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === '/api/auth/session') {
        return new Response(
          JSON.stringify({
            csrfToken: 'csrf-test',
            user: {
              id: 'aaaaaaaa-0000-4000-8000-000000000002',
              email: 'person@example.test',
              fullName: 'Test User',
            },
            tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/stage')) return new Response(null, { status: 204 });
      const isSummary = url.endsWith('/dashboard-summary');
      return new Response(JSON.stringify(isSummary ? summary : body), {
        status: isSummary ? 200 : status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('DealsDashboard', () => {
  it('shows a loading state then renders exact deal values in an accessible table', async () => {
    const fetch = stubFetch({ total: 1, items: [deal] });
    render(<DealsDashboard />);

    expect(screen.getByText('Loading…')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(await screen.findByRole('row', { name: /Northstar Systems/ })).toBeVisible();
    expect(screen.getAllByText(/R 1 234 567 890 123,45/)).toHaveLength(2);
    expect(screen.getByText('31 Mar 2027')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      '/api/deals?limit=25&offset=0&sort=created&direction=desc',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
  });

  it('shows the audit trail in the list and composes table filters and sort controls', async () => {
    const routedDeal = {
      ...deal,
      stage: 'ic_review',
      created_by: { userId: 'bbbbbbbb-0000-4000-8000-000000000001', displayName: 'Amara Ndlovu' },
      updated_by: { userId: 'bbbbbbbb-0000-4000-8000-000000000002', displayName: 'Lerato Molefe' },
      assigned_to: [
        {
          userId: 'bbbbbbbb-0000-4000-8000-000000000003',
          displayName: 'Sibusiso Dlamini',
          role: 'lead',
        },
      ],
      approval: {
        requestId: 'bbbbbbbb-0000-4000-8000-000000000004',
        status: 'rejected',
        requestedBy: {
          userId: 'bbbbbbbb-0000-4000-8000-000000000005',
          displayName: 'Amara Ndlovu',
        },
        approvers: [
          {
            userId: 'bbbbbbbb-0000-4000-8000-000000000006',
            displayName: 'Naledi Khumalo',
            decision: 'reject',
            reason: 'Quorum no longer reachable',
          },
        ],
        rejectionReason: 'Quorum no longer reachable',
        approvedBy: [],
        rejected: true,
      },
      rejected: true,
      rejection_reason: 'Quorum no longer reachable',
    };
    const fetch = stubFetch({ total: 1, items: [routedDeal] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    const row = await screen.findByRole('row', { name: /Northstar Systems/ });
    expect(row).toHaveTextContent('Amara Ndlovu');
    expect(row).toHaveTextContent('Lerato Molefe');
    expect(row).toHaveTextContent('Sibusiso Dlamini');
    expect(row).toHaveTextContent('Rejected by Naledi Khumalo');
    expect(row).toHaveTextContent('Quorum no longer reachable');

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter sector' }), {
      target: { value: 'Energy' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Assigned to' }), {
      target: { value: 'Sibusiso' },
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'IC approval' }), 'rejected');
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        '/api/deals?limit=25&offset=0&sort=created&direction=desc&sector=Energy&assignedTo=Sibusiso&approvalStatus=rejected',
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Deal/ }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        '/api/deals?limit=25&offset=0&sort=name&direction=asc&sector=Energy&assignedTo=Sibusiso&approvalStatus=rejected',
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Deal/ }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        '/api/deals?limit=25&offset=0&sort=name&direction=desc&sector=Energy&assignedTo=Sibusiso&approvalStatus=rejected',
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter sector' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Assigned to' }), {
      target: { value: '' },
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'IC approval' }), '');
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        '/api/deals?limit=25&offset=0&sort=name&direction=desc',
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );
  });

  it('explains approval and outcome rules in an expandable guide', async () => {
    stubFetch({ total: 1, items: [{ ...deal, stage: 'ic_review' }] });
    render(<DealsDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    const user = userEvent.setup();
    const disclosure = await screen.findByText('How deal stages work');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    await user.click(disclosure);
    const guidance = disclosure.closest('details');
    expect(guidance).not.toBeNull();
    expect(guidance).toHaveTextContent(
      'open an IC Review deal and request approval from its IC approval section.',
    );
    expect(guidance).toHaveTextContent(
      'A rejected request stays in IC Review; the deal moves to Signed only when the approval quorum is reached.',
    );
    expect(screen.getByRole('link', { name: 'Open IC approval' })).toHaveAttribute(
      'href',
      `/deals/${deal.id}#approval-title`,
    );
    expect(guidance).toHaveTextContent('Deal size, sector, and expected close date are required.');
    expect(guidance).toHaveTextContent('Passed: use this outcome when a deal exits the pipeline.');
  });

  it('links IC Review deal editing to the approval request section', async () => {
    stubFetch({ total: 1, items: [{ ...deal, stage: 'ic_review' }] });
    const user = userEvent.setup();
    render(<DealsDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Edit Northstar Systems' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit Northstar Systems' });
    expect(dialog).toHaveTextContent(
      'IC approval requests are made in the approval section. A Deal Lead or another user with approval-request access can submit one there.',
    );
    expect(within(dialog).getByRole('link', { name: 'Open IC approval' })).toHaveAttribute(
      'href',
      `/deals/${deal.id}#approval-title`,
    );
  });

  it('filters the deal list when a pipeline stage count is selected', async () => {
    const fetch = stubFetch({ total: 1, items: [deal] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Filter deals to Sourcing (1)' }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/deals?limit=25&offset=0&sort=created&direction=desc&stage=sourcing',
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );
  });

  it('offers a stage board and moves a deal only to an allowed, complete destination', async () => {
    const fetch = stubFetch({ total: 1, items: [deal] });
    const user = userEvent.setup();
    render(<DealsDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('region', { name: 'Sourcing stage, 1 deals' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Northstar Systems' })).toHaveAttribute(
      'href',
      `/deals/${deal.id}`,
    );

    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      getData: () => deal.id,
      setData: vi.fn<(...values: string[]) => void>(),
    };
    const card = screen.getByRole('link', { name: 'Northstar Systems' }).closest('article');
    const screening = screen.getByRole('region', { name: 'Screening stage, 0 deals' });
    const closed = screen.getByRole('region', { name: 'Closed stage, 0 deals' });
    if (!card) throw new Error('Deal card was not rendered.');
    fireEvent.drop(closed, { dataTransfer });
    expect(fetch).not.toHaveBeenCalledWith(`/api/deals/${deal.id}/stage`, expect.anything());
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragEnter(screening, { dataTransfer });
    fireEvent.dragLeave(screening, { dataTransfer, relatedTarget: null });
    fireEvent.dragEnter(screening, { dataTransfer });
    fireEvent.dragOver(screening, { dataTransfer });
    fireEvent.drop(screening, { dataTransfer });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/deals/${deal.id}/stage`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', deal.id);
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragEnd(card, { dataTransfer });
  });

  it('names the fields that block a move into IC Review', async () => {
    stubFetch({
      total: 1,
      items: [
        {
          ...deal,
          stage: 'due_diligence',
          sector: null,
          amount: null,
          expected_close_date: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Move to…' }));

    const moveButton = screen.getByRole('button', { name: 'Move to IC Review' });
    expect(moveButton).toBeDisabled();
    expect(moveButton.parentElement).toHaveTextContent(/Requires/);
    expect(moveButton.parentElement).toHaveTextContent(/deal size/);
    expect(moveButton.parentElement).toHaveTextContent(/sector/);
    expect(moveButton.parentElement).toHaveTextContent(/expected close date/);
  });

  it('submits stage and search filters and provides an empty state', async () => {
    const fetch = stubFetch({ total: 0, items: [] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    await screen.findByText('No deals found');
    await user.type(screen.getByRole('searchbox', { name: 'Search deals' }), 'Northstar');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pipeline stage' }), 'screening');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch.mock.calls[3]?.[0]).toBe(
      '/api/deals?limit=25&offset=0&sort=created&direction=desc&stage=screening&search=Northstar',
    );
    expect(screen.getByText('Try changing the search or stage filter.')).toBeVisible();
  });

  it('shows a safe API error to the user', async () => {
    stubFetch({ error: { code: 'forbidden', message: 'You are not allowed to do that.' } }, 403);
    render(<DealsDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do that.');
  });

  it('lets the user retry a failed pipeline summary', async () => {
    let summaryCalls = 0;
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith('/dashboard-summary') && summaryCalls++ === 0) {
          return new Response(JSON.stringify({ error: { message: 'Summary unavailable.' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify(
            url.endsWith('/dashboard-summary') ? dashboardSummary : { total: 0, items: [] },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealsDashboard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Summary unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry summary' }));
    await user.click(await screen.findByText('Stage counts and upcoming close dates'));
    expect(await screen.findByText('Deals by stage')).toBeVisible();
  });

  it('shows the empty pipeline summary and unavailable closing dates', async () => {
    const emptySummary = {
      ...dashboardSummary,
      totalsByCurrency: [],
      closingSoonCount: 2,
      closingSoon: [],
    };
    stubFetch({ total: 0, items: [] }, 200, emptySummary);
    render(<DealsDashboard />);

    expect(await screen.findByText('No valued open deals')).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByText('Stage counts and upcoming close dates'));
    expect(
      screen.getByText('No active deals have an expected close date in this window.'),
    ).toBeVisible();
    expect(screen.getByText('Showing the 10 nearest close dates.')).toBeVisible();
  });

  it('reports precise amount validation errors when creating a deal', async () => {
    stubFetch({ total: 0, items: [] });
    const user = userEvent.setup();
    render(<DealsDashboard />);

    await screen.findByText('No deals found');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));
    await user.type(screen.getByRole('textbox', { name: 'Deal name' }), 'Northstar Systems');
    await user.type(screen.getByRole('textbox', { name: 'Deal size' }), '1.2345');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/non-negative amount/i);
  });

  it('uses one pipeline create action and lets the user close the inline form', async () => {
    stubFetch({ total: 0, items: [] });
    const user = userEvent.setup();
    render(<DealsDashboard />);

    await screen.findByText('No deals found');
    expect(screen.getAllByRole('button', { name: 'Create deal' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Create deal' }));
    expect(await screen.findByRole('heading', { name: 'Create a deal' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create a deal' })).not.toBeInTheDocument();
  });

  it('refreshes pipeline deals and summary after a live deal change', async () => {
    const fetch = stubFetch({ total: 1, items: [deal] });
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([url]) => typeof url === 'string' && url.endsWith('/dashboard-summary'),
        ),
      ).toHaveLength(1),
    );

    window.dispatchEvent(new Event('dpt:deals-changed'));

    await waitFor(() => {
      expect(
        fetch.mock.calls.filter(
          ([url]) => typeof url === 'string' && url.includes('/deals?limit=25'),
        ),
      ).toHaveLength(2);
      expect(
        fetch.mock.calls.filter(
          ([url]) => typeof url === 'string' && url.endsWith('/dashboard-summary'),
        ),
      ).toHaveLength(2);
    });
  });

  it('renders the tenant currency totals and closing-soon countdown', async () => {
    const summary = {
      ...dashboardSummary,
      closingSoonCount: 1,
      closingSoon: [
        {
          id: deal.id,
          name: 'Northstar Systems',
          stage: 'sourcing' as const,
          amount: '123456789012345',
          currency: 'ZAR',
          expectedCloseDate: '2026-11-09',
          expectedCloseTime: null,
          closesInDays: 12,
          closesAt: null,
          ...closingDealMetadata,
        },
      ],
    };
    stubFetch({ total: 0, items: [] }, 200, summary);
    render(<DealsDashboard />);

    const user = userEvent.setup();
    await user.click(await screen.findByText('Stage counts and upcoming close dates'));
    expect(await screen.findByText('12 days left')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Northstar Systems' })).toHaveAttribute(
      'href',
      `/deals/${deal.id}`,
    );
    expect(screen.getAllByText(/R 1 234 567 890 123,45/)).toHaveLength(1);
    expect(screen.getByText('Closing in 60 days')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Upcoming close dates' })).toBeVisible();
    expect(
      screen.getByText(
        /Created by Amara Ndlovu · Updated by Lerato Molefe · Assigned to Sibusiso Dlamini \(lead\) · Approved by Naledi Khumalo · Rejected: Quorum no longer reachable/,
      ),
    ).toBeVisible();
  });

  it('creates a deal using exact minor units and refreshes the list', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url === '/api/auth/session') {
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'aaaaaaaa-0000-4000-8000-000000000002',
                email: 'person@example.test',
                fullName: 'Test User',
              },
              tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ dealId: 'aaaaaaaa-0000-4000-8000-000000000001' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ total: 0, items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealsDashboard />);

    await screen.findByText('No deals found');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));
    await user.type(screen.getByRole('textbox', { name: 'Deal name' }), 'Northstar Systems');
    await user.type(screen.getByRole('textbox', { name: 'Sector' }), 'Technology');
    await user.type(screen.getByRole('textbox', { name: 'Deal size' }), '1250000.75');
    await user.type(screen.getByLabelText('Expected close date'), '2027-03-31');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));

    await screen.findByText('Deal created.');
    const postCall = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall?.[0]).toBe('/api/deals');
    expect(postCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Northstar Systems',
          sector: 'Technology',
          amount: '125000075',
          currency: 'ZAR',
          expectedCloseDate: '2027-03-31',
        }),
      }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
  });

  it('offers an accessible move-to control and uses the current optimistic version', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url === '/api/auth/session') {
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'aaaaaaaa-0000-4000-8000-000000000002',
                email: 'person@example.test',
                fullName: 'Test User',
              },
              tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ version: 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ total: 1, items: [deal] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.click(screen.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('button', { name: 'Move to Screening' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Northstar Systems moved to Screening.',
    );
    const moveCall = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(moveCall?.[0]).toBe('/api/deals/aaaaaaaa-0000-4000-8000-000000000001/stage');
    expect(moveCall?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ toStage: 'screening', expectedVersion: 1 }),
      }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
  });

  it('edits only changed fields and includes the deal version', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url === '/api/auth/session') {
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'aaaaaaaa-0000-4000-8000-000000000002',
                email: 'person@example.test',
                fullName: 'Test User',
              },
              tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({ version: 2 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ total: 1, items: [deal] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Edit Northstar Systems' }));
    expect(screen.getByRole('dialog', { name: 'Edit Northstar Systems' })).toBeVisible();
    const dialog = screen.getByRole('dialog', { name: 'Edit Northstar Systems' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Deal name' }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Deal name' }),
      'Northstar Updated',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Northstar Systems updated.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const updateCall = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(updateCall?.[0]).toBe('/api/deals/aaaaaaaa-0000-4000-8000-000000000001');
    expect(updateCall?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ expectedVersion: 1, name: 'Northstar Updated' }),
      }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
  });

  it('saves all changed deal fields together', async () => {
    const editDeal = { ...deal, expected_close_time: '15:30:00' };
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === '/api/auth/session')
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'aaaaaaaa-0000-4000-8000-000000000002',
                email: 'person@example.test',
                fullName: 'Test User',
              },
              tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
            }),
            { status: 200 },
          );
        if (init?.method === 'PUT')
          return new Response(JSON.stringify({ version: 2 }), { status: 200 });
        const isSummary = url.endsWith('/dashboard-summary');
        return new Response(
          JSON.stringify(isSummary ? dashboardSummary : { total: 1, items: [editDeal] }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Edit Northstar Systems' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Northstar Systems' });
    async function updateField(label: string, value: string) {
      const field = within(dialog).getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, value);
    }
    await updateField('Deal name', 'Northstar Updated');
    await updateField('Sector', 'Healthcare');
    await updateField('Deal size', '987.65');
    await updateField('Currency', 'USD');
    await updateField('Expected close date', '2027-04-01');
    await updateField('Expected close time', '16:45');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Northstar Systems updated.');
    const update = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(update?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          expectedVersion: 1,
          name: 'Northstar Updated',
          sector: 'Healthcare',
          amount: '98765',
          currency: 'USD',
          expectedCloseDate: '2027-04-01',
          expectedCloseTime: '16:45',
        }),
      }),
    );
  });

  it('shows a useful message and skips the update when no deal fields changed', async () => {
    const fetch = stubFetch({ total: 1, items: [deal] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Edit Northstar Systems' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('No changes to save.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      `/api/deals/${deal.id}`,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('shows the API error when a stage move is rejected', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === '/api/auth/session') {
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'aaaaaaaa-0000-4000-8000-000000000002',
                email: 'u@example.test',
                fullName: 'User',
              },
              tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
            }),
            { status: 200 },
          );
        }
        if (init?.method === 'POST')
          return new Response(
            JSON.stringify({
              error: {
                code: 'approval_required',
                message: 'Approval is required before moving this deal.',
              },
            }),
            { status: 409 },
          );
        const isSummary = url.endsWith('/dashboard-summary');
        return new Response(
          JSON.stringify(isSummary ? dashboardSummary : { total: 1, items: [deal] }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('button', { name: 'Move to Screening' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Approval is required');
  });

  it('reports a list load failure and lets the user retry', async () => {
    let fail = true;
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === '/api/auth/session')
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'aaaaaaaa-0000-4000-8000-000000000002',
                email: 'u@example.test',
                fullName: 'User',
              },
              tenantId: 'aaaaaaaa-0000-4000-8000-000000000003',
            }),
            { status: 200 },
          );
        if (url.endsWith('/dashboard-summary'))
          return new Response(JSON.stringify(dashboardSummary), { status: 200 });
        if (fail)
          return new Response(
            JSON.stringify({ error: { code: 'temporary_failure', message: 'Temporary failure' } }),
            { status: 503 },
          );
        return new Response(JSON.stringify({ total: 1, items: [deal] }), { status: 200 });
      },
    );
    vi.stubGlobal('fetch', fetch);
    render(<DealsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure');
    fail = false;
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search deals' }), 'Northstar');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('row', { name: /Northstar Systems/ })).toBeVisible();
  });

  it('does not create a deal when the amount cannot be parsed', async () => {
    const fetch = stubFetch({ total: 0, items: [] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    await screen.findByText('No deals found');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));
    await user.type(screen.getByRole('textbox', { name: 'Deal name' }), 'Northstar Systems');
    await user.type(screen.getByRole('textbox', { name: 'Deal size' }), 'not money');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/amount/i);
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/deals',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
