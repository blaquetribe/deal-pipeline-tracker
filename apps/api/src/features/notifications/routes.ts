import { notificationListSchema } from '@dpt/shared';
import { z } from 'zod';

import { HttpError } from '../../http/errors';
import { noBody, sessionRoute, type HttpDeps, type Route } from '../../http/route';

export interface NotificationRoutesOptions {
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
}

export function createNotificationRoutes({ userRpc }: NotificationRoutesOptions): Route[] {
  const list = sessionRoute({
    method: 'GET',
    path: '/notifications',
    body: noBody,
    handler: async ({ session }) => {
      if (!session.tenantId) {
        throw new HttpError(
          409,
          'tenant_required',
          'Choose an organisation to view notifications.',
        );
      }
      const notifications = notificationListSchema.parse(
        await userRpc.call(
          'list_notifications',
          { p_tenant: session.tenantId, p_limit: 50 },
          session.accessToken,
        ),
      );
      return { body: notifications };
    },
  });

  const markRead = sessionRoute({
    method: 'POST',
    path: '/notifications/:notificationId/read',
    body: noBody,
    handler: async ({ params, session }) => {
      const notificationId = z.uuid().safeParse(params.notificationId);
      if (!notificationId.success) {
        throw new HttpError(400, 'invalid_request', 'The notification id is invalid.');
      }
      await userRpc.call(
        'mark_notification_read',
        { p_notification: notificationId.data },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  return [list, markRead];
}

export function mountNotificationRoutes(
  app: Parameters<Route['mount']>[0],
  deps: HttpDeps,
  options: NotificationRoutesOptions,
): Route[] {
  const routes = createNotificationRoutes(options);
  for (const route of routes) route.mount(app, deps);
  return routes;
}
