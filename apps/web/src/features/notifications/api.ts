import {
  closingAlertSettingsSchema,
  notificationListSchema,
  updateClosingAlertSettingsBodySchema,
  type ClosingAlertSettings,
} from '@dpt/shared';

import { sessionRead, sessionRequest } from '../auth/api';

export async function readNotifications() {
  return notificationListSchema.parse(await sessionRead('/notifications'));
}

export async function markNotificationRead(id: string): Promise<void> {
  await sessionRequest(`/notifications/${id}/read`, 'POST');
}

export async function readClosingAlertSettings(): Promise<ClosingAlertSettings> {
  return closingAlertSettingsSchema.parse(await sessionRead('/closing-alert-settings'));
}

export async function updateClosingAlertSettings(settings: ClosingAlertSettings): Promise<void> {
  const body = updateClosingAlertSettingsBodySchema.parse(settings);
  await sessionRequest('/closing-alert-settings', 'PUT', body);
}
