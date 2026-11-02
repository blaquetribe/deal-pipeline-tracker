import { notificationSchema } from '@dpt/shared';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

type RealtimeTransport = NonNullable<
  NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>['transport']
>;
// ws implements the browser WebSocket surface Supabase Realtime uses in Node.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const realtimeTransport = WebSocket as RealtimeTransport;

export interface RealtimeFeedOptions {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly channelName: string;
  readonly tenantId: string;
  readonly accessToken: string;
  readonly onSubscribed: () => void;
  readonly onNotification: (row: unknown) => void;
  readonly onDealsChanged: () => void;
  readonly onUnavailable: (status: string) => void;
}

export interface RealtimeFeed {
  updateAccessToken(token: string): void;
  close(): void;
}

/** Subscribes as the session user; Postgres RLS remains the delivery authorization boundary. */
export async function createRealtimeFeed(options: RealtimeFeedOptions): Promise<RealtimeFeed> {
  let accessToken = options.accessToken;
  let channel: RealtimeChannel | null = null;
  const client = createClient(options.supabaseUrl, options.anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    accessToken: async () => accessToken,
    realtime: { transport: realtimeTransport, vsn: '1.0.0' },
  });
  // Realtime otherwise starts the socket before its async accessToken callback resolves,
  // causing the first Postgres Changes join to be validated as anon.
  await client.realtime.setAuth(accessToken);

  channel = client
    .channel(options.channelName, { config: { postgres_changes_options: { wait: true } } })
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `tenant_id=eq.${options.tenantId}`,
      },
      (payload) => {
        const row = payload.new as {
          readonly id?: unknown;
          readonly kind?: unknown;
          readonly payload?: unknown;
          readonly created_at?: unknown;
          readonly read_at?: unknown;
        };
        // The user JWT lets Postgres RLS authorize each row; the active-tenant filter keeps
        // this relay scoped when Realtime omits internal identity columns from its payload.
        const notification = notificationSchema.safeParse({
          id: row.id,
          kind: row.kind,
          payload: row.payload,
          created_at: row.created_at,
          read_at: row.read_at,
        });
        if (notification.success) options.onNotification(notification.data);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deal_events',
        filter: `tenant_id=eq.${options.tenantId}`,
      },
      () => options.onDealsChanged(),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tenant_change_signals',
        filter: `tenant_id=eq.${options.tenantId}`,
      },
      () => options.onDealsChanged(),
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tenant_change_signals',
        filter: `tenant_id=eq.${options.tenantId}`,
      },
      () => options.onDealsChanged(),
    )
    .subscribe((status) => {
      const value = status.toString();
      if (value === 'SUBSCRIBED') options.onSubscribed();
      if (value === 'CHANNEL_ERROR' || value === 'TIMED_OUT' || value === 'CLOSED') {
        options.onUnavailable(value);
      }
    });

  return {
    updateAccessToken(token) {
      accessToken = token;
      void client.realtime.setAuth(token).catch(() => options.onUnavailable('TOKEN_REFRESH_ERROR'));
    },
    close() {
      if (!channel) return;
      void client.removeChannel(channel);
      channel = null;
    },
  };
}
