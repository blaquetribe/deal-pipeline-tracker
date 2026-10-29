import type { DashboardSummary } from '@dpt/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    expect(screen.getByText('Loading deals…')).toBeVisible();
    expect(await screen.findByRole('row', { name: /Northstar Systems/ })).toBeVisible();
    expect(screen.getAllByText(/R 1 234 567 890 123,45/)).toHaveLength(2);
    expect(screen.getByText('31 Mar 2027')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      '/api/deals?limit=25&offset=0',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
  });

  it('offers a stage board and moves a deal only to an allowed, complete destination', async () => {
    const fetch = stubFetch({ total: 1, items: [deal] });
    const user = userEvent.setup();
    render(<DealsDashboard />);

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
      '/api/deals?limit=25&offset=0&stage=screening&search=Northstar',
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
    await user.click(screen.getByText('New deal'));
    await user.type(screen.getByRole('textbox', { name: 'Deal name' }), 'Northstar Systems');
    await user.type(screen.getByRole('textbox', { name: 'Deal size' }), '1.2345');
    await user.click(screen.getByRole('button', { name: 'Create deal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/non-negative amount/i);
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
        },
      ],
    };
    stubFetch({ total: 0, items: [] }, 200, summary);
    render(<DealsDashboard />);

    expect(await screen.findByText('12 days left')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Northstar Systems' })).toHaveAttribute(
      'href',
      `/deals/${deal.id}`,
    );
    expect(screen.getAllByText(/R 1 234 567 890 123,45/)).toHaveLength(1);
    expect(screen.getAllByText('Closing soon')).toHaveLength(2);
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
    await user.click(screen.getByText('New deal'));
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
    await screen.findByRole('row', { name: /Northstar Systems/ });

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Move Northstar Systems to stage' }),
      'screening',
    );
    await user.click(screen.getByRole('button', { name: 'Move' }));

    expect(await screen.findByText('Northstar Systems moved to Screening.')).toBeVisible();
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
    await screen.findByRole('row', { name: /Northstar Systems/ });
    await user.click(screen.getByText('Edit deal'));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Northstar Updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Northstar Systems updated.')).toBeVisible();
    const updateCall = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(updateCall?.[0]).toBe('/api/deals/aaaaaaaa-0000-4000-8000-000000000001');
    expect(updateCall?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ expectedVersion: 1, name: 'Northstar Updated' }),
      }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
  });
});
