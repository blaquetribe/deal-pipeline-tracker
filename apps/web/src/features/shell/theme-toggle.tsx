'use client';

import { useSyncExternalStore } from 'react';

import { Button } from '../ui/button';
import { Icon } from '../ui/icon';

function toggleTheme() {
  const nextDark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', nextDark);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `theme=${nextDark ? 'dark' : 'light'}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  document.dispatchEvent(new Event('theme-change'));
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    (notify) => {
      document.addEventListener('theme-change', notify);
      return () => document.removeEventListener('theme-change', notify);
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );

  return (
    <Button
      aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
      onClick={toggleTheme}
      className="account-menu-item"
      size="small"
      type="button"
      variant="quiet"
    >
      <Icon className="size-4" name={dark ? 'sun' : 'moon'} />
      {dark ? 'Light mode' : 'Dark mode'}
    </Button>
  );
}
