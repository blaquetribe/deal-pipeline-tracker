'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { sessionRequest } from './api';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setError(null);
    setPending(true);
    try {
      await sessionRequest('/auth/logout', 'POST');
      router.push('/login');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign out could not be completed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-2 text-sm text-danger-fg" role="alert">
          {error}
        </p>
      )}
      <Button
        className="account-menu-item text-sm"
        disabled={pending}
        onClick={() => void signOut()}
        size="small"
        type="button"
        variant="quiet"
      >
        <Icon className="size-4" name="logout" />
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}
