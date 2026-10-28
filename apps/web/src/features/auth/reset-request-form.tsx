'use client';

import { resetRequestBodySchema } from '@dpt/shared';
import { useId, useState, type FormEvent } from 'react';

import { authRequest } from './api';

export function ResetRequestForm() {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const parsed = resetRequestBodySchema.safeParse({
      email: new FormData(event.currentTarget).get('email'),
    });
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }
    setPending(true);
    try {
      await authRequest('/auth/password-reset', parsed.data);
      setMessage('If the account is eligible, a password reset link will arrive shortly.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The request could not be completed. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {(message || error) && (
        <p
          className={error ? 'text-sm text-danger-fg' : 'text-sm text-fg-muted'}
          role={error ? 'alert' : 'status'}
        >
          {error ?? message}
        </p>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-email`}>
          Email address
        </label>
        <input
          autoComplete="email"
          className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
          id={`${id}-email`}
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </div>
      <button
        className="w-full rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
