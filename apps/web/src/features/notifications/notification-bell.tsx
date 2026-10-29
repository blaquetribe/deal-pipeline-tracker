'use client';

import { notificationSchema, type Notification } from '@dpt/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { markNotificationRead, readNotifications } from './api';

const MAX_NOTIFICATIONS = 50;

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
  const onNotificationOpen = async (notification: Notification) => {
    if (notification.read_at !== null) return;
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item,
      ),
    );
    try {
      await markNotificationRead(notification.id);
    } catch {
      void refresh();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
        className="border-border rounded-control border bg-surface-raised px-3 py-2 text-sm text-fg hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {toast ? (
        <aside className="material-glass-strong fixed inset-x-4 bottom-4 z-30 flex max-w-lg items-start justify-between gap-4 rounded-panel p-4 sm:inset-x-auto sm:end-4">
          <div>
            <p className="text-sm text-fg-muted">
              {toast.kind === 'closing_soon' ? 'Closing soon alert' : 'Approval alert'}
            </p>
            <Link href={toast.payload.href} className="font-medium underline">
              {toast.payload.dealName}
            </Link>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification alert"
            className="text-fg-muted underline"
            onClick={() => {
              setToast(null);
              if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
              toastTimer.current = undefined;
            }}
          >
            Dismiss
          </button>
        </aside>
      ) : null}
      <span className="sr-only">
        {connected ? 'Live updates connected.' : 'Live updates reconnecting.'}
      </span>
      {open ? (
        <section
          id="notification-panel"
          aria-label="Notifications"
          className="material-glass-strong absolute start-0 end-0 z-20 mt-2 w-[min(24rem,calc(100vw-3rem))] rounded-panel p-4 sm:start-auto"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <button
              type="button"
              className="text-sm text-fg-muted underline"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
          {loading ? <p className="mt-4 text-sm text-fg-muted">Loading notifications…</p> : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {!loading && !error && notifications.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">You’re all caught up.</p>
          ) : null}
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <Link
                  href={notification.payload.href}
                  onClick={() => void onNotificationOpen(notification)}
                  className={`block rounded-control p-3 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-accent ${notification.read_at === null ? 'border-s-2 border-accent' : ''}`}
                >
                  <span className="block font-medium">{notification.payload.dealName}</span>
                  <span className="block text-sm text-fg-muted">
                    {notification.kind === 'closing_soon'
                      ? `${notification.payload.overdue ? 'Closing date passed' : `Closing in ${notification.payload.thresholdDays} days`} · ${notification.payload.closeDate}`
                      : notification.payload.message}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
