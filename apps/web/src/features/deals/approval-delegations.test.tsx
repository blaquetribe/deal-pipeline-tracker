import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovalDelegations } from './approval-delegations';

const delegateId = 'dddddddd-0000-4000-8000-000000000001';
const recordId = 'dddddddd-0000-4000-8000-000000000002';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ApprovalDelegations', () => {
  it('schedules and revokes a personal, time-bounded delegation', async () => {
    let records: object[] = [];
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === '/api/auth/session') {
          return new Response(
            JSON.stringify({
              csrfToken: 'csrf-test',
              user: {
                id: 'cccccccc-0000-4000-8000-000000000001',
                email: 'user@example.test',
                fullName: 'Current member',
              },
              tenantId: 'cccccccc-0000-4000-8000-000000000002',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (url === '/api/approval-delegations' && init?.method === 'POST') {
          records = [
            {
              id: recordId,
              delegatorMembershipId: 'eeeeeeee-0000-4000-8000-000000000001',
              delegatorName: 'Current member',
              delegateMembershipId: delegateId,
              delegateName: 'Delegate member',
              startsAt: new Date('2027-03-01T09:00').toISOString(),
              endsAt: new Date('2027-03-03T17:00').toISOString(),
              active: false,
              canCancel: true,
            },
          ];
          return new Response(JSON.stringify({ delegationId: recordId }), { status: 201 });
        }
        if (url === `/api/approval-delegations/${recordId}` && init?.method === 'DELETE') {
          records = [];
          return new Response(null, { status: 204 });
        }
        const body =
          url === '/api/approval-delegation-options'
            ? [{ membershipId: delegateId, displayName: 'Delegate member' }]
            : records;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<ApprovalDelegations />);
    const starts = await screen.findByLabelText('Starts');
    const ends = screen.getByLabelText('Ends');
    fireEvent.change(starts, { target: { value: '2027-03-01T09:00' } });
    fireEvent.change(ends, { target: { value: '2027-03-03T17:00' } });
    await user.click(screen.getByRole('button', { name: 'Schedule delegation' }));

    expect(await screen.findByText(/Current member → Delegate member/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/approval-delegations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          delegateMembershipId: delegateId,
          startsAt: new Date('2027-03-01T09:00').toISOString(),
          endsAt: new Date('2027-03-03T17:00').toISOString(),
        }),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Revoke delegation' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke delegation' })).not.toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/approval-delegations/${recordId}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows existing delegate records when no additional delegate is eligible', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === '/api/auth/session') {
        return new Response(
          JSON.stringify({
            csrfToken: 'csrf-test',
            user: {
              id: 'cccccccc-0000-4000-8000-000000000001',
              email: 'user@example.test',
              fullName: 'Current member',
            },
            tenantId: 'cccccccc-0000-4000-8000-000000000002',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body =
        url === '/api/approval-delegation-options'
          ? []
          : [
              {
                id: recordId,
                delegatorMembershipId: 'eeeeeeee-0000-4000-8000-000000000001',
                delegatorName: null,
                delegateMembershipId: delegateId,
                delegateName: null,
                startsAt: '2027-03-01T09:00:00Z',
                endsAt: '2027-03-03T17:00:00Z',
                active: true,
                canCancel: false,
              },
            ];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);

    render(<ApprovalDelegations />);

    expect(await screen.findByText('Unnamed member → Unnamed member')).toBeInTheDocument();
    expect(screen.getByText(/Active/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke delegation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule delegation' })).not.toBeInTheDocument();
  });

  it('shows a safe load failure when delegation data cannot be read', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === '/api/auth/session') {
        return new Response(
          JSON.stringify({
            csrfToken: 'csrf-test',
            user: {
              id: 'cccccccc-0000-4000-8000-000000000001',
              email: 'user@example.test',
              fullName: 'Current member',
            },
            tenantId: 'cccccccc-0000-4000-8000-000000000002',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ error: { code: 'failed', message: 'Delegation service unavailable.' } }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetch);

    render(<ApprovalDelegations />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Delegation service unavailable.');
  });
});
