'use client';

import { resetRequestBodySchema } from '@dpt/shared';
import { useId, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
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
        <Input
          autoComplete="email"
          className="w-full"
          id={`${id}-email`}
          maxLength={254}
          name="email"
          required
          type="email"
        />
      </div>
      <Button className="w-full" disabled={pending} variant="primary" type="submit">
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
