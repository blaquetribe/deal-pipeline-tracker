import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markNotificationRead, readNotifications } from './api';
import { NotificationBell } from './notification-bell';
import { requestOpenNotifications } from './notification-events';

vi.mock('./api', () => ({
  markNotificationRead: vi.fn<() => Promise<void>>(async () => undefined),
  readNotifications: vi.fn<() => Promise<unknown>>(async () => []),
}));

const row = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  kind: 'closing_soon',
  payload: {
    dealId: 'bbbbbbbb-0000-4000-8000-000000000002',
    dealName: 'Example deal',
    stage: 'sourcing',
    amount: '1000',
    currency: 'ZAR',
    closeDate: '2026-11-01',
    closeTime: null,
    timeZone: 'Africa/Johannesburg',
    thresholdDays: 5,
    href: '/deals/bbbbbbbb-0000-4000-8000-000000000002',
  },
  created_at: '2026-10-28T10:00:00Z',
  read_at: null,
} as const;

const readRow = {
  ...row,
  id: 'bbbbbbbb-0000-4000-8000-000000000005',
  read_at: '2026-10-29T10:00:00Z',
};

const approvalAlert = {
  id: 'bbbbbbbb-0000-4000-8000-000000000003',
  kind: 'approval_quorum_unreachable',
  payload: {
    dealId: 'bbbbbbbb-0000-4000-8000-000000000002',
    dealName: 'Example deal',
    message: 'Approval quorum can no longer be reached.',
    href: '/deals/bbbbbbbb-0000-4000-8000-000000000002',
  },
  created_at: '2026-10-28T10:00:00Z',
  read_at: null,
} as const;

const approvalSlaAlert = {
  id: 'bbbbbbbb-0000-4000-8000-000000000004',
  kind: 'approval_sla_escalation',
  payload: {
    dealId: 'bbbbbbbb-0000-4000-8000-000000000002',
    dealName: 'Example deal',
    message: 'IC approval has been waiting for more than 24 hours.',
    href: '/deals/bbbbbbbb-0000-4000-8000-000000000002',
  },
  created_at: '2026-10-28T10:00:00Z',
  read_at: null,
} as const;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  private readonly listeners = new Map<string, EventListener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  private dispatch(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close() {
    this.dispatch('close', new Event('close'));
  }

  open() {
    this.dispatch('open', new Event('open'));
  }

  message(data: unknown) {
    this.dispatch('message', new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

describe('notification bell', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.mocked(readNotifications).mockResolvedValue([]);
    vi.mocked(markNotificationRead).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the empty state and refreshes from same-origin realtime inserts', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    await screen.findByText(/You’re all caught up/);
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveClass(
      'material-glass-strong',
    );
    expect(FakeWebSocket.instances[0]?.url).toContain('/ws');
    FakeWebSocket.instances[0]?.open();
    await waitFor(() => expect(readNotifications).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Live updates reconnecting.')).toBeInTheDocument();
    FakeWebSocket.instances[0]?.message({ type: 'status', status: 'connected' });
    expect(await screen.findByText('Live updates connected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute(
      'title',
      'Live updates connected',
    );
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: row });
    expect(await screen.findByText('New closing soon alert: Example deal.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open deal' })).toHaveAttribute(
      'href',
      row.payload.href,
    );
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: row });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification alert' }));
    expect(screen.queryByText('Closing soon alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Open deal' })).toHaveAttribute(
      'href',
      row.payload.href,
    );
    const link = screen.getByRole('link', { name: 'Open deal' });
    const click = createEvent.click(link);
    click.preventDefault();
    fireEvent(link, click);
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(row.id));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('publishes deal invalidation events received over the authenticated socket', () => {
    const changed = vi.fn<() => void>();
    window.addEventListener('dpt:deals-changed', changed);
    render(<NotificationBell compact />);
    FakeWebSocket.instances[0]?.message({ type: 'deals_changed' });
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener('dpt:deals-changed', changed);
  });

  it('opens the mounted notification panel from the account menu action', async () => {
    vi.mocked(readNotifications).mockResolvedValue([row]);
    render(<NotificationBell />);

    act(() => requestOpenNotifications());

    expect(await screen.findByRole('region', { name: 'Notifications' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open deal' })).toHaveAttribute(
      'href',
      row.payload.href,
    );
  });

  it('removes handled notifications from Unread while retaining them in All', async () => {
    vi.mocked(readNotifications)
      .mockResolvedValueOnce([row])
      .mockResolvedValue([{ ...readRow, id: row.id }]);
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Example deal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(row.id));
    expect(await screen.findByText(/You’re all caught up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Example deal')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('offers bulk read and starts with unread items only', async () => {
    const secondUnread = { ...row, id: `${row.id}-2` };
    vi.mocked(readNotifications)
      .mockResolvedValueOnce([row, secondUnread, readRow])
      .mockResolvedValue([
        { ...readRow, id: row.id },
        { ...readRow, id: secondUnread.id },
        readRow,
      ]);
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findAllByText('Example deal')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(row.id));
    expect(markNotificationRead).toHaveBeenCalledWith(secondUnread.id);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(await screen.findByText(/You’re all caught up/)).toBeInTheDocument();
  });

  it('reports load failures and ignores invalid socket messages', async () => {
    vi.mocked(readNotifications).mockRejectedValue(new Error('database details must not render'));
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Notifications could not be loaded.',
    );
    expect(screen.queryByText('database details must not render')).not.toBeInTheDocument();
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: { dealName: 'bad' } });
    expect(screen.queryByText('bad')).not.toBeInTheDocument();
  });

  it('renders approval quorum alerts in the list and live toast', async () => {
    vi.mocked(readNotifications).mockResolvedValue([approvalAlert]);
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(
      await screen.findByText('Approval quorum can no longer be reached.'),
    ).toBeInTheDocument();
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: approvalAlert });
    expect(await screen.findByText('Approval alert')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Approval alert: Example deal. Approval quorum can no longer be reached.',
      ),
    ).toBeInTheDocument();
  });

  it('labels overdue IC escalations distinctly in the list, toast, and live announcement', async () => {
    vi.mocked(readNotifications).mockResolvedValue([approvalSlaAlert]);
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(
      await screen.findByText('IC approval has been waiting for more than 24 hours.'),
    ).toBeInTheDocument();
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: approvalSlaAlert });
    expect(await screen.findByText('Approval SLA alert')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Overdue IC approval alert: Example deal. IC approval has been waiting for more than 24 hours.',
      ),
    ).toBeInTheDocument();
  });

  it('clears the live toast timer when the bell unmounts', async () => {
    const view = render(<NotificationBell />);
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: row });
    expect(await screen.findByText('Closing soon alert')).toBeInTheDocument();
    expect(screen.getByText('Closing soon alert').closest('aside')).toHaveClass(
      'material-glass-strong',
    );
    view.unmount();
  });
});
