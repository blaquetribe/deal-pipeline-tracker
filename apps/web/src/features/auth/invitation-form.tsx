'use client';

import {
  invitationPreviewResponseSchema,
  invitationRegistrationBodySchema,
  invitationRegistrationResponseSchema,
  type InvitationPreviewResponse,
} from '@dpt/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { ApiClientError, authRequest, sessionRequest } from './api';
import { LoginForm } from './login-form';

export function InvitationForm({ token }: { readonly token: string | null }) {
  const id = useId();
  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [acceptAfterSignIn, setAcceptAfterSignIn] = useState(true);
  const [acceptedTenantId, setAcceptedTenantId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) {
        setError('This invitation link is invalid or expired. Ask the inviter for a new link.');
        setLoading(false);
        return;
      }
      try {
        const result = invitationPreviewResponseSchema.parse(
          await authRequest('/auth/invitations/preview', { token }),
        );
        if (active) setPreview(result);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'This invitation link is invalid or expired.',
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const parsed = invitationRegistrationBodySchema.safeParse({
      token,
      password: form.get('password'),
      fullName: form.get('fullName'),
    });
    if (!parsed.success) {
      setError('Check your name and password. Use at least 12 characters for the password.');
      return;
    }
    setPending(true);
    try {
      const result = invitationRegistrationResponseSchema.parse(
        await authRequest('/auth/invitations/register', parsed.data),
      );
      if (result.signInRequired) {
        setAcceptedTenantId(result.tenantId);
        setAcceptAfterSignIn(false);
        setExistingAccount(true);
        return;
      }
      window.location.assign('/onboarding');
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'sign_in_required') {
        setExistingAccount(true);
      } else {
        setError(cause instanceof Error ? cause.message : 'The invitation could not be accepted.');
      }
    } finally {
      setPending(false);
    }
  }

  if (loading) return <output>Checking invitation…</output>;
  if (!preview)
    return (
      <p className="text-danger-fg" role="alert">
        {error}
      </p>
    );

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 rounded-control border border-line bg-surface-subtle p-4 sm:grid-cols-[8rem_1fr]">
        <dt className="font-medium">Organisation</dt>
        <dd>{preview.tenantName}</dd>
        <dt className="font-medium">Invited by</dt>
        <dd>{preview.inviterEmail}</dd>
        <dt className="font-medium">Role</dt>
        <dd>{preview.roleName}</dd>
        <dt className="font-medium">Invited email</dt>
        <dd>{preview.email}</dd>
      </dl>
      <p className="text-sm text-fg-muted">
        The organisation name is self-declared by its members. This link expires after seven days.
      </p>
      {existingAccount ? (
        <section aria-labelledby="invite-signin-heading" className="space-y-3">
          <h2 className="text-lg font-medium" id="invite-signin-heading">
            Sign in to accept
          </h2>
          <p className="text-sm text-fg-muted">
            Use the invited email address. The invitation is accepted after sign-in.
          </p>
          <LoginForm
            onAuthenticated={async () => {
              if (acceptAfterSignIn) {
                await sessionRequest('/auth/invitations/accept', 'POST', { token });
              } else if (acceptedTenantId) {
                await sessionRequest('/auth/tenant', 'POST', { tenantId: acceptedTenantId });
              }
            }}
          />
        </section>
      ) : (
        <form className="space-y-4" onSubmit={register}>
          {error && (
            <p className="text-sm text-danger-fg" role="alert">
              {error}
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-name`}>
              Full name
            </label>
            <input
              autoComplete="name"
              className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
              id={`${id}-name`}
              maxLength={100}
              name="fullName"
              required
              type="text"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-password`}>
              Create a password
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
            {pending ? 'Accepting invitation…' : 'Create account and accept'}
          </button>
        </form>
      )}
    </div>
  );
}
