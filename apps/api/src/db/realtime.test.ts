import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  callback: null as ((payload: { new: unknown }) => void) | null,
  status: null as ((status: string) => void) | null,
  channelName: '',
  channelOptions: null as unknown,
  changeFilter: null as unknown,
  changeFilters: [] as unknown[],
  callbacks: [] as Array<(payload: { new: unknown }) => void>,
  clientOptions: null as unknown,
  setAuth: vi.fn<(token: string) => Promise<void>>(async () => undefined),
  removeChannel: vi.fn<() => Promise<string>>(async () => 'ok'),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn<(...args: unknown[]) => unknown>((_url, _key, clientOptions) => {
    mockState.clientOptions = clientOptions;
    type MockChannel = {
      on(event: string, filter: unknown, callback: (payload: { new: unknown }) => void): unknown;
      subscribe(status: (value: string) => void): unknown;
    };
    let channel: MockChannel;
    channel = {
      on: vi.fn<(...args: [string, unknown, (payload: { new: unknown }) => void]) => unknown>(
        (_event: string, filter: unknown, callback: (payload: { new: unknown }) => void) => {
          mockState.changeFilter = filter;
          mockState.callback = callback;
          mockState.changeFilters.push(filter);
          mockState.callbacks.push(callback);
          return channel;
        },
      ),
      subscribe: vi.fn<(status: (value: string) => void) => unknown>((status) => {
        mockState.status = status;
        return channel;
      }),
    };
    return {
      channel: vi.fn<(name: string, options?: unknown) => unknown>((name, options) => {
        mockState.channelName = name;
        mockState.channelOptions = options;
        return channel;
      }),
      realtime: { setAuth: mockState.setAuth },
      removeChannel: mockState.removeChannel,
    };
  }),
}));

import { createRealtimeFeed } from './realtime';

describe('user-scoped Realtime feed', () => {
  beforeEach(() => {
    mockState.callback = null;
    mockState.status = null;
    mockState.channelName = '';
    mockState.channelOptions = null;
    mockState.changeFilter = null;
    mockState.changeFilters = [];
    mockState.callbacks = [];
    mockState.clientOptions = null;
    mockState.setAuth.mockClear();
    mockState.removeChannel.mockClear();
  });

  it('scopes the tenant feed, validates deliveries, refreshes JWT and closes cleanly', async () => {
    const onNotification = vi.fn<(row: unknown) => void>();
    const onDealsChanged = vi.fn<() => void>();
    const onSubscribed = vi.fn<() => void>();
    const onUnavailable = vi.fn<(status: string) => void>();
    const feed = await createRealtimeFeed({
      supabaseUrl: 'http://supabase-gateway:8000',
      anonKey: 'public-anon-key',
      channelName: 'notifications:user-a:tenant-a',
      tenantId: 'tenant-a',
      accessToken: 'jwt-a',
      onSubscribed,
      onNotification,
      onDealsChanged,
      onUnavailable,
    });
    expect(mockState.channelName).toBe('notifications:user-a:tenant-a');
    expect(mockState.clientOptions).toMatchObject({
      realtime: { transport: expect.any(Function), vsn: '1.0.0' },
    });
    expect(mockState.channelOptions).toMatchObject({
      config: { postgres_changes_options: { wait: true } },
    });
    expect(mockState.changeFilters).toContainEqual({
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: 'tenant_id=eq.tenant-a',
    });
    expect(mockState.changeFilters).toContainEqual({
      event: 'INSERT',
      schema: 'public',
      table: 'deal_events',
      filter: 'tenant_id=eq.tenant-a',
    });
    mockState.callbacks[1]?.({ new: { id: 'deal-private-row' } });
    expect(onDealsChanged).toHaveBeenCalledOnce();
    mockState.status?.('SUBSCRIBED');
    expect(onSubscribed).toHaveBeenCalledOnce();
    expect(onUnavailable).not.toHaveBeenCalled();
    const row = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      tenant_id: 'tenant-a',
      user_id: 'user-a',
      kind: 'closing_soon',
      deal_id: 'bbbbbbbb-0000-4000-8000-000000000001',
      dedupe_key: 'private-dedupe-value',
      payload: {
        dealId: 'bbbbbbbb-0000-4000-8000-000000000001',
        dealName: 'Example deal',
        stage: 'sourcing',
        amount: '1000',
        currency: 'ZAR',
        closeDate: '2026-11-01',
        closeTime: null,
        timeZone: 'Africa/Johannesburg',
        thresholdDays: 5,
        href: '/deals/bbbbbbbb-0000-4000-8000-000000000001',
      },
      created_at: '2026-10-28T10:00:00Z',
      read_at: null,
    };
    mockState.callbacks[0]?.({ new: row });
    mockState.callbacks[0]?.({ new: { ...row, payload: { invalid: true } } });
    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith({
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      created_at: row.created_at,
      read_at: row.read_at,
    });

    mockState.status?.('CHANNEL_ERROR');
    expect(onUnavailable).toHaveBeenCalledWith('CHANNEL_ERROR');
    feed.updateAccessToken('jwt-b');
    await vi.waitFor(() => expect(mockState.setAuth).toHaveBeenCalledWith('jwt-b'));
    feed.close();
    expect(mockState.removeChannel).toHaveBeenCalledOnce();
    feed.close();
    expect(mockState.removeChannel).toHaveBeenCalledOnce();
  });

  it('closes on Realtime timeout and treats a rejected token refresh as unavailable', async () => {
    const onUnavailable = vi.fn<(status: string) => void>();
    const feed = await createRealtimeFeed({
      supabaseUrl: 'http://supabase-gateway:8000',
      anonKey: 'public-anon-key',
      channelName: 'notifications:user-a:tenant-a',
      tenantId: 'tenant-a',
      accessToken: 'jwt-a',
      onSubscribed: vi.fn<() => void>(),
      onNotification: vi.fn<(row: unknown) => void>(),
      onDealsChanged: vi.fn<() => void>(),
      onUnavailable,
    });
    mockState.status?.('TIMED_OUT');
    expect(onUnavailable).toHaveBeenCalledWith('TIMED_OUT');
    mockState.setAuth.mockRejectedValueOnce(new Error('private upstream error'));
    feed.updateAccessToken('jwt-b');
    await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('TOKEN_REFRESH_ERROR'));
    feed.close();
  });
});
