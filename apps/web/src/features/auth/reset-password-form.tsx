'use client';

import { resetBodySchema } from '@dpt/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';

import { authRequest } from './api';

export function ResetPasswordForm({ token }: { readonly token: string | null }) {
  const id = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = new FormData(event.currentTarget).get('password');
    const parsed = resetBodySchema.safeParse({ token, password });
    if (!parsed.success) {
      setError('Use a password of at least 12 characters that is not common.');
      return;
    }
    setPending(true);
    try {
      await authRequest('/auth/password-reset/complete', parsed.data);
      setUpdated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This reset link is invalid or expired.');
    } finally {
      setPending(false);
    }
  }

  if (updated) {
    return (
      <div className="space-y-4">
        <output>Your password has been changed. Sign in with your new password.</output>
        <Link
          className="inline-flex rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover"
          href="/login"
        >
          Continue to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && (
        <p className="text-sm text-danger-fg" role="alert">
          {error}
        </p>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-password`}>
          New password
        </label>
        <input
          autoComplete="new-password"
          className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
          id={`${id}-password`}
          maxLength={128}
          minLength={12}
          name="password"
          required
          type="password"
        />
        <p className="mt-1 text-sm text-fg-muted">
          Use at least 12 characters. Password managers and paste are welcome.
        </p>
      </div>
      <button
        className="w-full rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Updating…' : 'Set new password'}
      </button>
      <button
        className="text-sm text-brand-fg underline underline-offset-4"
        onClick={() => router.push('/login')}
        type="button"
      >
        Back to sign in
      </button>
    </form>
  );
}
