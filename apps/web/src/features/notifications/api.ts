import { notificationListSchema } from '@dpt/shared';

import { sessionRead, sessionRequest } from '../auth/api';

export async function readNotifications() {
  return notificationListSchema.parse(await sessionRead('/notifications'));
}

export async function markNotificationRead(id: string): Promise<void> {
  await sessionRequest(`/notifications/${id}/read`, 'POST');
}
