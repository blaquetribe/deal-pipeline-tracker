import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DealDetail } from './deal-detail';

const dealId = 'aaaaaaaa-0000-4000-8000-000000000001';
const deal = {
  id: dealId,
  name: 'Northstar Systems',
  stage: 'sourcing',
  version: 2,
  sector: 'Technology',
  amount: '125000075',
  currency: 'ZAR',
  expected_close_date: '2027-03-31',
  expected_close_time: '15:30:00',
  created_at: '2026-10-28T10:00:00+00:00',
};
const activity = {
  events: [
    {
      seq: '9007199254740993',
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      kind: 'note',
      body: 'Initial diligence started.',
      actorId: 'cccccccc-0000-4000-8000-000000000001',
      actorName: 'Test User',
      actorEmail: 'person@example.test',
      createdAt: '2026-10-28T10:00:00+00:00',
      amendsEventId: null,
    },
  ],
  hasMore: false,
  integrityOk: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('DealDetail', () => {
  it('shows overview and verified append-only activity', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return new Response(JSON.stringify(url.endsWith('/activity') ? activity : deal), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);

    render(<DealDetail dealId={dealId} />);
    expect(await screen.findByRole('heading', { name: 'Northstar Systems' })).toBeVisible();
    expect(screen.getByText('Activity integrity verified')).toBeVisible();
    expect(screen.getByText('Initial diligence started.')).toBeVisible();
    expect(screen.getByText(/R 1 250 000,75/)).toBeVisible();
    expect(screen.getByText(/cannot be edited or deleted/)).toBeVisible();
  });

  it('posts a note, then refreshes the authoritative activity timeline', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === '/api/auth/session') {
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'cccccccc-0000-4000-8000-000000000001',
                email: 'person@example.test',
                fullName: 'Test User',
              },
              tenantId: 'cccccccc-0000-4000-8000-000000000002',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ eventId: 'bbbbbbbb-0000-4000-8000-000000000002' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(url.endsWith('/activity') ? activity : deal), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    await screen.findByRole('heading', { name: 'Northstar Systems' });
    await user.type(screen.getByRole('textbox', { name: 'Add a note' }), '  Follow-up booked.  ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe(`/api/deals/${dealId}/notes`);
    expect(post?.[1]?.body).toBe(JSON.stringify({ body: 'Follow-up booked.' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
  });

  it('loads older activity with the exact sequence cursor', async () => {
    const olderEvent = {
      ...activity.events[0],
      seq: '9007199254740992',
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      body: 'Earlier activity.',
    };
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      const response = url.includes('beforeSeq=')
        ? { events: [olderEvent], hasMore: false, integrityOk: true }
        : url.endsWith('/activity')
          ? { ...activity, hasMore: true }
          : deal;
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    await screen.findByText('Initial diligence started.');
    await user.click(screen.getByRole('button', { name: 'Load older activity' }));

    expect(await screen.findByText('Earlier activity.')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      `/api/deals/${dealId}/activity?beforeSeq=9007199254740993`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(screen.queryByRole('button', { name: 'Load older activity' })).not.toBeInTheDocument();
  });

  it('shows empty activity, unverified integrity, and optional deal fields', async () => {
    const sparseDeal = {
      ...deal,
      sector: null,
      amount: null,
      expected_close_date: null,
      expected_close_time: null,
    };
    const emptyActivity = { events: [], hasMore: false, integrityOk: false };
    vi.stubGlobal(
      'fetch',
      vi.fn<(...args: [RequestInfo | URL]) => Promise<Response>>(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        return new Response(
          JSON.stringify(url.endsWith('/activity') ? emptyActivity : sparseDeal),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }),
    );

    render(<DealDetail dealId={dealId} />);

    expect(await screen.findByText('Activity integrity check failed')).toBeVisible();
    expect(screen.getByText('No activity yet.')).toBeVisible();
    expect(screen.getAllByText('Not set')).toHaveLength(3);
  });

  it('renders non-note event kinds and falls back to the actor email', async () => {
    const nonNoteActivity = {
      ...activity,
      events: [
        {
          ...activity.events[0],
          kind: 'stage_change',
          body: 'Moved from sourcing to screening.',
          actorName: null,
          amendsEventId: 'bbbbbbbb-0000-4000-8000-000000000099',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<(...args: [RequestInfo | URL]) => Promise<Response>>(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        return new Response(JSON.stringify(url.endsWith('/activity') ? nonNoteActivity : deal), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    render(<DealDetail dealId={dealId} />);

    expect(await screen.findByText('stage change')).toBeVisible();
    expect(screen.getByText('person@example.test', { exact: false })).toBeVisible();
  });

  it('retries a failed detail load', async () => {
    let detailCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.endsWith('/activity') && detailCalls++ === 0) {
          return new Response(JSON.stringify({ error: { message: 'Details unavailable.' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(url.endsWith('/activity') ? activity : deal), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const user = userEvent.setup();
    render(<DealDetail dealId={dealId} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Details unavailable.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Northstar Systems' })).toBeVisible();
  });

  it('reports an older activity load failure without losing the timeline', async () => {
    const fetch = vi.fn<(...args: [RequestInfo | URL]) => Promise<Response>>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('beforeSeq=')) {
        return new Response(JSON.stringify({ error: { message: 'Older activity unavailable.' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify(url.endsWith('/activity') ? { ...activity, hasMore: true } : deal),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DealDetail dealId={dealId} />);
    await screen.findByText('Initial diligence started.');

    await user.click(screen.getByRole('button', { name: 'Load older activity' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Older activity unavailable.');
    expect(screen.getByText('Initial diligence started.')).toBeVisible();
  });
});
