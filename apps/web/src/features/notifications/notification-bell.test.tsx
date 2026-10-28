import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markNotificationRead, readNotifications } from './api';
import { NotificationBell } from './notification-bell';

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
};

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
    await screen.findByText('You’re all caught up.');
    expect(FakeWebSocket.instances[0]?.url).toContain('/ws');
    FakeWebSocket.instances[0]?.open();
    await waitFor(() => expect(readNotifications).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Live updates reconnecting.')).toBeInTheDocument();
    FakeWebSocket.instances[0]?.message({ type: 'status', status: 'connected' });
    expect(await screen.findByText('Live updates connected.')).toBeInTheDocument();
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: row });
    expect(await screen.findByText('New closing soon alert: Example deal.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Example deal$/ })).toHaveAttribute(
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
    expect(screen.getByRole('link', { name: /Example deal/ })).toHaveAttribute(
      'href',
      row.payload.href,
    );
    const link = screen.getByRole('link', { name: /Example deal/ });
    const click = createEvent.click(link);
    click.preventDefault();
    fireEvent(link, click);
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(row.id));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
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

  it('clears the live toast timer when the bell unmounts', async () => {
    const view = render(<NotificationBell />);
    FakeWebSocket.instances[0]?.message({ type: 'notification', data: row });
    expect(await screen.findByText('Closing soon alert')).toBeInTheDocument();
    view.unmount();
  });
});
