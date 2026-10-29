'use client';

import { loginBodySchema } from '@dpt/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { authRequest } from './api';

export function LoginForm({ onAuthenticated }: { readonly onAuthenticated?: () => Promise<void> }) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const parsed = loginBodySchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });
    if (!parsed.success) {
      setError('Enter a valid email address and password.');
      return;
    }

    setPending(true);
    try {
      await authRequest('/auth/login', parsed.data);
      await onAuthenticated?.();
      router.push('/onboarding');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          className="rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
          role="alert"
        >
          {error}
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
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-password`}>
          Password
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
          id={`${id}-password`}
          maxLength={1024}
          name="password"
          required
          type="password"
        />
      </div>
      <Button className="w-full" disabled={pending} variant="primary" type="submit">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link className="text-brand-fg underline underline-offset-4" href="/forgot-password">
          Forgot password?
        </Link>
        <Link className="text-brand-fg underline underline-offset-4" href="/signup">
          Create an account
        </Link>
      </div>
    </form>
  );
}
