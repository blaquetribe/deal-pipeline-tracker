'use client';

import { signupBodySchema } from '@dpt/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { authRequest } from './api';

export function SignupForm() {
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
    const parsed = signupBodySchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
      fullName: form.get('fullName'),
    });
    if (!parsed.success) {
      setError('Check the fields. Use a password of at least 12 characters that is not common.');
      return;
    }

    setPending(true);
    try {
      await authRequest('/auth/signup', parsed.data);
      router.push('/check-email');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'We could not start registration. Try again.',
      );
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
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-name`}>
          Full name
        </label>
        <Input
          autoComplete="name"
          className="w-full"
          id={`${id}-name`}
          maxLength={100}
          name="fullName"
          required
          type="text"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-email`}>
          Work email
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
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-password`}>
          Password
        </label>
        <Input
          autoComplete="new-password"
          className="w-full"
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
      <Button className="w-full" disabled={pending} variant="primary" type="submit">
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-sm text-fg-muted">
        Already registered?{' '}
        <Link className="text-brand-fg underline underline-offset-4" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
