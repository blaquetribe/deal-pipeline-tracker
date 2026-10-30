import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn<(path: string) => Promise<unknown>>(),
  request:
    vi.fn<(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<unknown>>(),
}));
vi.mock('../auth/api', () => ({ sessionRead: mocks.read, sessionRequest: mocks.request }));

import {
  markNotificationRead,
  readClosingAlertSettings,
  readNotifications,
  updateClosingAlertSettings,
} from './api';

describe('closing alert settings API client', () => {
  it('reads notifications and marks one as read', async () => {
    mocks.read.mockResolvedValueOnce([]);
    await expect(readNotifications()).resolves.toEqual([]);
    await markNotificationRead('bbbbbbbb-0000-4000-8000-000000000001');
    expect(mocks.read).toHaveBeenCalledWith('/notifications');
    expect(mocks.request).toHaveBeenCalledWith(
      '/notifications/bbbbbbbb-0000-4000-8000-000000000001/read',
      'POST',
    );
  });

  it('validates settings returned by the API', async () => {
    mocks.read.mockResolvedValueOnce({
      alertDays: [10, 5, 1],
      alertOnOverdue: true,
      extraRecipients: 'ic',
    });

    await expect(readClosingAlertSettings()).resolves.toEqual({
      alertDays: [10, 5, 1],
      alertOnOverdue: true,
      extraRecipients: 'ic',
    });
    expect(mocks.read).toHaveBeenCalledWith('/closing-alert-settings');
  });

  it('validates settings before sending an authenticated update', async () => {
    const settings = {
      alertDays: [] as number[],
      alertOnOverdue: false,
      extraRecipients: 'all' as const,
    };
    await updateClosingAlertSettings(settings);
    expect(mocks.request).toHaveBeenCalledWith('/closing-alert-settings', 'PUT', settings);
    await expect(updateClosingAlertSettings({ ...settings, alertDays: [5, 5] })).rejects.toThrow(
      /Thresholds must be unique/,
    );
  });
});
