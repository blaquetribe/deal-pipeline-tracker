'use client';

import { resendBodySchema } from '@dpt/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { authRequest } from './api';

export function ResendForm() {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [error, message]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const parsed = resendBodySchema.safeParse({
      email: new FormData(event.currentTarget).get('email'),
    });
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }
    setPending(true);
    try {
      await authRequest('/auth/resend', parsed.data);
      setMessage('If the account needs verification, a new link will arrive shortly.');
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
          ref={statusRef}
          tabIndex={-1}
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
        {pending ? 'Sending…' : 'Resend verification link'}
      </Button>
    </form>
  );
}
