import { render, screen, waitFor } from '@testing-library/react';
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

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (_input, _init) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
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
    expect(screen.getByText(/R 1 234 567 890 123,45/)).toBeVisible();
    expect(screen.getByText('31 Mar 2027')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      '/api/deals?limit=25&offset=0',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    );
  });

  it('submits stage and search filters and provides an empty state', async () => {
    const fetch = stubFetch({ total: 0, items: [] });
    const user = userEvent.setup();
    render(<DealsDashboard />);
    await screen.findByText('No deals found');
    await user.type(screen.getByRole('searchbox', { name: 'Search deals' }), 'Northstar');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pipeline stage' }), 'screening');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2]?.[0]).toBe(
      '/api/deals?limit=25&offset=0&stage=screening&search=Northstar',
    );
    expect(screen.getByText('Try changing the search or stage filter.')).toBeVisible();
  });

  it('shows a safe API error to the user', async () => {
    stubFetch({ error: { code: 'forbidden', message: 'You are not allowed to do that.' } }, 403);
    render(<DealsDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do that.');
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });
});
