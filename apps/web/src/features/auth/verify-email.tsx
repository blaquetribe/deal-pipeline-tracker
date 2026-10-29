'use client';

import { tokenSchema } from '@dpt/shared';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '../ui/button';
import { authRequest } from './api';

export function VerifyEmail({ token }: { readonly token: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  async function confirm() {
    setError(null);
    const parsed = tokenSchema.safeParse(token);
    if (!parsed.success) {
      setError(
        'This verification link is invalid or has expired. Request another link and try again.',
      );
      return;
    }
    setPending(true);
    try {
      await authRequest('/auth/verify', { token: parsed.data });
      setVerified(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This verification link is invalid or has expired.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {verified ? (
        <>
          <output className="text-success-fg">
            Your email is verified. Sign in to continue setup.
          </output>
          <Link
            className="inline-flex rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover"
            href="/login"
          >
            Continue to sign in
          </Link>
        </>
      ) : (
        <>
          <p>This link verifies your email. It can only be used once.</p>
          {error && (
            <p className="text-sm text-danger-fg" role="alert">
              {error}
            </p>
          )}
          <Button disabled={pending} onClick={confirm} type="button" variant="primary">
            {pending ? 'Verifying…' : 'Verify email'}
          </Button>
        </>
      )}
    </div>
  );
}
