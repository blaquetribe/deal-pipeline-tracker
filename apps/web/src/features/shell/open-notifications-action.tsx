'use client';

import { requestOpenNotifications } from '../notifications';
import { Icon } from '../ui/icon';
import { requestCloseAccountMenu } from './account-menu-events';

export function OpenNotificationsAction() {
  return (
    <button
      aria-label="Open notifications"
      className="account-menu-item"
      onClick={() => {
        requestOpenNotifications();
        requestCloseAccountMenu();
      }}
      type="button"
    >
      <Icon className="size-4" name="bell" />
      Notifications
    </button>
  );
}
