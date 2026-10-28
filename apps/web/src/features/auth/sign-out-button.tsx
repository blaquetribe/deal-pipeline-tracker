'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
      <button
        className="rounded-control border border-line px-3 py-2 text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        onClick={() => void signOut()}
        type="button"
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
