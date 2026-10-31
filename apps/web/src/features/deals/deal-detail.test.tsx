import type { DealApprovalStatus } from '@dpt/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const approvalStatus = {
  requestId: null,
  status: null,
  requiredApprovals: null,
  configuredApprovals: null,
  approvedCount: 0,
  pendingCount: 0,
  rejectedCount: 0,
  currentUserDecision: null,
  delegatedSlots: [],
  canRequest: false,
  canDecide: false,
  canConfigure: false,
  canManageAbsence: false,
  canReassign: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('DealDetail', () => {
  it('shows overview and verified append-only activity', async () => {
    const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return new Response(
        JSON.stringify(
          url.endsWith('/activity') ? activity : url.endsWith('/approval') ? approvalStatus : deal,
        ),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetch);

    render(<DealDetail dealId={dealId} />);
    expect(await screen.findByRole('heading', { name: 'Northstar Systems' })).toBeVisible();
    expect(screen.getByText('Activity integrity verified')).toBeVisible();
    expect(screen.getByText('Initial diligence started.')).toBeVisible();
    const history = screen.getByRole('region', { name: 'Deal activity history' });
    expect(within(history).getByRole('list')).toBeVisible();
    expect(screen.getByText(/R 1 250 000,75/)).toBeVisible();
    expect(screen.getByText('31 Mar 2027 at 15:30')).toBeVisible();
    expect(screen.getByText(/cannot be edited or deleted/)).toBeVisible();
  });

  it('explains who must request IC approval when the current user lacks access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<(...args: [RequestInfo | URL]) => Promise<Response>>(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        const response = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? approvalStatus
            : { ...deal, stage: 'ic_review' };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    render(<DealDetail dealId={dealId} />);

    expect(
      await screen.findByText(
        'No IC approval request has been submitted. A Deal Lead or another user with approval-request access must submit it from this section.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Request IC approval' })).not.toBeInTheDocument();
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
        return new Response(
          JSON.stringify(
            url.endsWith('/activity')
              ? activity
              : url.endsWith('/approval')
                ? approvalStatus
                : deal,
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
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
          : url.endsWith('/approval')
            ? approvalStatus
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

  it('submits an approval request from IC review and refreshes the authoritative status', async () => {
    const icDeal = { ...deal, stage: 'ic_review' as const };
    let requested = false;
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
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
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith('/approval-requests')) {
          requested = true;
          return new Response(
            JSON.stringify({ requestId: 'bbbbbbbb-0000-4000-8000-000000000003' }),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        const currentStatus = requested
          ? {
              ...approvalStatus,
              requestId: 'bbbbbbbb-0000-4000-8000-000000000003',
              status: 'pending',
              requiredApprovals: 2,
            }
          : { ...approvalStatus, configuredApprovals: 2, canRequest: true };
        const body = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? currentStatus
            : icDeal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    expect(
      await screen.findByText(/Send this deal to the eligible IC members for a decision/),
    ).toBeVisible();
    await user.click(await screen.findByRole('button', { name: 'Request IC approval' }));

    expect(await screen.findByText(/Required approvals: 2/)).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      `/api/deals/${dealId}/approval-requests`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2 }) }),
    );
  });

  it('schedules and cancels the signed-in approver’s own absence', async () => {
    const absenceId = 'dddddddd-0000-4000-8000-000000000001';
    let absence: {
      id: string;
      startsAt: string;
      endsAt: string;
      active: boolean;
    } | null = null;
    const status = { ...approvalStatus, canManageAbsence: true };
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
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url === '/api/approval-absences' && init?.method === 'POST') {
          absence = {
            id: absenceId,
            startsAt: new Date('2027-03-01T09:00').toISOString(),
            endsAt: new Date('2027-03-03T17:00').toISOString(),
            active: false,
          };
          return new Response(JSON.stringify({ absenceId }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === `/api/approval-absences/${absenceId}` && init?.method === 'DELETE') {
          absence = null;
          return new Response(null, { status: 204 });
        }
        const body = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? status
            : url === '/api/approval-delegations' || url === '/api/approval-delegation-options'
              ? []
              : url === '/api/approval-absences'
                ? absence
                  ? [absence]
                  : []
                : deal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    const startsAt = await screen.findByLabelText('Starts');
    const endsAt = screen.getByLabelText('Ends');
    fireEvent.change(startsAt, { target: { value: '2027-03-01T09:00' } });
    fireEvent.change(endsAt, { target: { value: '2027-03-03T17:00' } });
    await user.click(screen.getByRole('button', { name: 'Schedule absence' }));

    expect(await screen.findByText(/Upcoming/)).toBeVisible();
    const expectedStartsAt = new Date('2027-03-01T09:00').toISOString();
    const expectedEndsAt = new Date('2027-03-03T17:00').toISOString();
    expect(fetch).toHaveBeenCalledWith(
      '/api/approval-absences',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ startsAt: expectedStartsAt, endsAt: expectedEndsAt }),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Cancel absence' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel absence' })).not.toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/approval-absences/${absenceId}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('lets a tenant manager reassign an unavailable approval slot from the deal panel', async () => {
    const requestId = 'bbbbbbbb-0000-4000-8000-000000000003';
    const unavailableMemberId = 'dddddddd-0000-4000-8000-000000000001';
    const replacementMemberId = 'dddddddd-0000-4000-8000-000000000002';
    let reassigned = false;
    const options = {
      unavailableApprovers: [{ membershipId: unavailableMemberId, displayName: 'Unavailable IC' }],
      eligibleReplacements: [{ membershipId: replacementMemberId, displayName: 'Replacement IC' }],
    };
    const status: DealApprovalStatus = {
      ...approvalStatus,
      requestId,
      status: 'pending',
      requiredApprovals: 2,
      configuredApprovals: 2,
      canReassign: true,
    };
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
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.endsWith('/reassignments') && init?.method === 'POST') {
          reassigned = true;
          return new Response(null, { status: 204 });
        }
        const body = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? { ...status, canReassign: !reassigned }
            : url.endsWith('/reassignment-options')
              ? options
              : deal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    await user.click(await screen.findByRole('button', { name: 'Reassign approver' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reassign approver' })).not.toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      `/api/approval-requests/${requestId}/reassignments`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fromMembershipId: unavailableMemberId,
          toMembershipId: replacementMemberId,
        }),
      }),
    );
  });

  it('configures quorum and lets an assigned IC member reject with a reason', async () => {
    const icDeal = { ...deal, stage: 'ic_review' as const };
    let status: DealApprovalStatus = {
      ...approvalStatus,
      requestId: 'bbbbbbbb-0000-4000-8000-000000000003',
      status: 'pending',
      requiredApprovals: 2,
      configuredApprovals: 2,
      approvedCount: 1,
      pendingCount: 1,
      canDecide: true,
      canConfigure: true,
      canManageAbsence: false,
      canReassign: false,
    };
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
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (init?.method === 'PUT') {
          return new Response(null, { status: 204 });
        }
        if (init?.method === 'POST') {
          status = { ...status, status: 'rejected', canDecide: false };
          return new Response(JSON.stringify({ status: 'rejected' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const body = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? status
            : url === '/api/approval-policy'
              ? { requiredApprovals: 2, delegationEnabled: false }
              : icDeal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    expect(await screen.findByText(/1 approved · 1 pending · 0 rejected/)).toBeVisible();
    await user.clear(screen.getByRole('spinbutton', { name: 'Required approvals' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Required approvals' }), '3');
    await user.click(screen.getByRole('checkbox', { name: 'Allow temporary approval delegation' }));
    await user.click(screen.getByRole('button', { name: 'Save approval policy' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/approval-policy',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ requiredApprovals: 3, delegationEnabled: true }),
        }),
      ),
    );

    await user.type(screen.getByRole('textbox', { name: 'Rejection reason (optional)' }), 'Risk');
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(
      await screen.findByText('Approval request failed because quorum was no longer reachable.'),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      '/api/approval-requests/bbbbbbbb-0000-4000-8000-000000000003/decisions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'reject', reason: 'Risk' }),
      }),
    );
  });

  it('shows an unconfigured quorum only to a user who can configure it', async () => {
    const icDeal = { ...deal, stage: 'ic_review' as const };
    const configurableStatus: DealApprovalStatus = {
      ...approvalStatus,
      canConfigure: true,
      canManageAbsence: false,
      canReassign: false,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<(...args: [RequestInfo | URL]) => Promise<Response>>(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        const body = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? configurableStatus
            : url === '/api/approval-policy'
              ? { requiredApprovals: null, delegationEnabled: false }
              : icDeal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    render(<DealDetail dealId={dealId} />);

    expect(
      await screen.findByText('No approval quorum is configured for this organisation.'),
    ).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Required approvals' })).toHaveValue(1);
    expect(screen.queryByRole('button', { name: 'Request IC approval' })).not.toBeInTheDocument();
  });

  it('lets an assigned IC member approve without a rejection reason', async () => {
    const icDeal = { ...deal, stage: 'ic_review' as const };
    const pendingStatus: DealApprovalStatus = {
      ...approvalStatus,
      requestId: 'bbbbbbbb-0000-4000-8000-000000000003',
      status: 'pending',
      requiredApprovals: 2,
      configuredApprovals: 2,
      canDecide: true,
    };
    let approved = false;
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
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (init?.method === 'POST') {
          approved = true;
          return new Response(JSON.stringify({ status: 'approved' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const body = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? approved
              ? { ...pendingStatus, status: 'approved', canDecide: false }
              : pendingStatus
            : icDeal;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    render(<DealDetail dealId={dealId} />);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Approval quorum reached.')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      '/api/approval-requests/bbbbbbbb-0000-4000-8000-000000000003/decisions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'approve' }) }),
    );
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
        const response = url.endsWith('/activity')
          ? emptyActivity
          : url.endsWith('/approval')
            ? approvalStatus
            : sparseDeal;
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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
          body: 'sourcing -> screening',
          actorName: null,
          amendsEventId: 'bbbbbbbb-0000-4000-8000-000000000099',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<(...args: [RequestInfo | URL]) => Promise<Response>>(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        const response = url.endsWith('/activity')
          ? nonNoteActivity
          : url.endsWith('/approval')
            ? approvalStatus
            : deal;
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    render(<DealDetail dealId={dealId} />);

    expect(await screen.findByText('Stage changed')).toBeVisible();
    expect(screen.getByText('Moved from Sourcing to Screening.')).toBeVisible();
    expect(screen.getByText('person@example.test', { exact: false })).toBeVisible();
  });

  it('retries a failed detail load', async () => {
    let detailCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.endsWith('/activity') && !url.endsWith('/approval') && detailCalls++ === 0) {
          return new Response(JSON.stringify({ error: { message: 'Details unavailable.' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const response = url.endsWith('/activity')
          ? activity
          : url.endsWith('/approval')
            ? approvalStatus
            : deal;
        return new Response(JSON.stringify(response), {
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
      const response = url.endsWith('/activity')
        ? { ...activity, hasMore: true }
        : url.endsWith('/approval')
          ? approvalStatus
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Older activity unavailable.');
    expect(screen.getByText('Initial diligence started.')).toBeVisible();
  });
});
