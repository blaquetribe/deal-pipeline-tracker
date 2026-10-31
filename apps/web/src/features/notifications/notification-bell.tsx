'use client';

import { notificationSchema, type Notification } from '@dpt/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../ui/button';
import { markNotificationRead, readNotifications } from './api';

const MAX_NOTIFICATIONS = 50;
const PENDING_READ_AT = 'pending';

function socketUrl(): string {
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
}

function parseMessage(data: string): Notification | null {
  try {
    const message: unknown = JSON.parse(data);
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      message.type !== 'notification' ||
      !('data' in message)
    ) {
      return null;
    }
    const parsed = notificationSchema.safeParse(message.data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isConnectedMessage(data: string): boolean {
  try {
    const message: unknown = JSON.parse(data);
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'status' &&
      'status' in message &&
      message.status === 'connected'
    );
  } catch {
    return false;
  }
}

function mergeNotification(current: readonly Notification[], next: Notification): Notification[] {
  return [next, ...current.filter((item) => item.id !== next.id)].slice(0, MAX_NOTIFICATIONS);
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [announcement, setAnnouncement] = useState('');
  const [toast, setToast] = useState<Notification | null>(null);
  const [connected, setConnected] = useState(false);
  const mounted = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const rows = await readNotifications();
      if (mounted.current) {
        setNotifications(rows);
        setError(null);
      }
    } catch {
      if (mounted.current) setError('Notifications could not be loaded.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => void refresh());
    let active = true;
    let retries = 0;
    let retryTimer: number | undefined;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (!active) return;
      socket = new WebSocket(socketUrl());
      socket.addEventListener('open', () => {
        if (!active) return;
        retries = 0;
        void refresh();
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        if (isConnectedMessage(event.data)) {
          setConnected(true);
          return;
        }
        const notification = parseMessage(event.data);
        if (!notification) return;
        setNotifications((current) => mergeNotification(current, notification));
        setToast(notification);
        setAnnouncement(
          notification.kind === 'closing_soon'
            ? `New closing soon alert: ${notification.payload.dealName}.`
            : notification.kind === 'approval_sla_escalation'
              ? `Overdue IC approval alert: ${notification.payload.dealName}. ${notification.payload.message}`
              : `Approval alert: ${notification.payload.dealName}. ${notification.payload.message}`,
        );
        if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => {
          setToast(null);
          toastTimer.current = undefined;
        }, 8_000);
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setConnected(false);
        const delay = Math.min(30_000, 500 * 2 ** Math.min(retries, 6));
        retries += 1;
        retryTimer = window.setTimeout(connect, delay);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    connect();
    return () => {
      active = false;
      mounted.current = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
      socket?.close();
    };
  }, [refresh]);

  const unreadCount = notifications.filter((item) => item.read_at === null).length;
  const visibleNotifications =
    filter === 'unread' ? notifications.filter((item) => item.read_at === null) : notifications;

  const markAsRead = async (notification: Notification) => {
    if (notification.read_at !== null) return;
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, read_at: PENDING_READ_AT } : item,
      ),
    );
    try {
      await markNotificationRead(notification.id);
      await refresh();
    } catch {
      setError('This notification could not be marked as read. Try again.');
      void refresh();
    }
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter((item) => item.read_at === null);
    if (unread.length === 0) return;
    setNotifications((current) =>
      current.map((item) => (item.read_at === null ? { ...item, read_at: PENDING_READ_AT } : item)),
    );
    try {
      await Promise.all(unread.map((item) => markNotificationRead(item.id)));
      await refresh();
    } catch {
      setError('Some notifications could not be marked as read. Try again.');
      void refresh();
    }
  };

  return (
    <div className="notification-bell relative inline-flex shrink-0">
      <Button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
        className="text-sm"
        variant="secondary"
      >
        Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
      </Button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {toast ? (
        <aside className="material-glass-strong fixed inset-x-4 bottom-4 z-30 flex max-w-lg items-start justify-between gap-4 rounded-panel p-4 sm:inset-x-auto sm:end-4">
          <div>
            <p className="text-sm text-fg-muted">
              {toast.kind === 'closing_soon'
                ? 'Closing soon alert'
                : toast.kind === 'approval_sla_escalation'
                  ? 'Approval SLA alert'
                  : 'Approval alert'}
            </p>
            <Link href={toast.payload.href} className="font-medium underline">
              {toast.payload.dealName}
            </Link>
          </div>
          <Button
            type="button"
            aria-label="Dismiss notification alert"
            size="small"
            variant="quiet"
            onClick={() => {
              setToast(null);
              if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
              toastTimer.current = undefined;
            }}
          >
            Dismiss
          </Button>
        </aside>
      ) : null}
      <span className="sr-only">
        {connected ? 'Live updates connected.' : 'Live updates reconnecting.'}
      </span>
      {open ? (
        <section
          id="notification-panel"
          aria-label="Notifications"
          className="notification-panel material-glass-strong rounded-panel p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <Button
              type="button"
              className="text-sm"
              onClick={() => void refresh()}
              size="small"
              variant="quiet"
            >
              Refresh
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <fieldset className="flex gap-1">
              <legend className="sr-only">Notification filter</legend>
              <Button
                aria-pressed={filter === 'unread'}
                onClick={() => setFilter('unread')}
                size="small"
                type="button"
                variant={filter === 'unread' ? 'primary' : 'quiet'}
              >
                Unread ({unreadCount})
              </Button>
              <Button
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
                size="small"
                type="button"
                variant={filter === 'all' ? 'primary' : 'quiet'}
              >
                All
              </Button>
            </fieldset>
            {unreadCount > 1 ? (
              <Button
                onClick={() => void markAllAsRead()}
                size="small"
                type="button"
                variant="quiet"
              >
                Mark all read
              </Button>
            ) : null}
          </div>
          {loading ? <p className="mt-4 text-sm text-fg-muted">Loading notifications…</p> : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {!loading && !error && visibleNotifications.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">
              {filter === 'unread'
                ? 'You’re all caught up. Switch to All to see earlier notifications.'
                : 'No notifications yet.'}
            </p>
          ) : null}
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {visibleNotifications.map((notification) => (
              <li key={notification.id}>
                <article
                  className={`rounded-control border border-line p-3 ${notification.read_at === null ? 'border-s-2 border-s-accent' : 'bg-surface-subtle'}`}
                >
                  <p className="font-medium">{notification.payload.dealName}</p>
                  <p className="mt-1 text-sm text-fg-muted">
                    {notification.kind === 'closing_soon'
                      ? `${notification.payload.overdue ? 'Closing date passed' : `Closing in ${notification.payload.thresholdDays} days`} · ${notification.payload.closeDate}`
                      : notification.payload.message}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={notification.payload.href}
                      onClick={() => void markAsRead(notification)}
                      className="text-sm font-semibold text-brand-fg underline underline-offset-4 focus-visible:outline-2"
                    >
                      Open deal
                    </Link>
                    {notification.read_at === null ? (
                      <Button
                        onClick={() => void markAsRead(notification)}
                        size="small"
                        type="button"
                        variant="secondary"
                      >
                        Mark as read
                      </Button>
                    ) : (
                      <span className="text-xs text-fg-muted">Read</span>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
