'use client';

import { inviteMemberBodySchema, type AssignableRole } from '@dpt/shared';
import Link from 'next/link';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SelectControl } from '../ui/select-control';
import { readAssignableRoles, sessionRequest } from './api';
import { PendingInvitations } from './pending-invitations';
import { TeamRoster } from './team-roster';

export function TeamManagement() {
  const id = useId();
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    void readAssignableRoles()
      .then((catalog) => {
        if (active) {
          setRoles(catalog.roles);
          setCanManageRoles(catalog.canManageRoles);
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Available roles could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = inviteMemberBodySchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the email and role.');
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await sessionRequest('/onboarding/invitations', 'POST', parsed.data);
      form.reset();
      setMessage(
        `Invitation sent to ${parsed.data.email} as ${roles.find((role) => role.key === parsed.data.roleKey)?.name ?? 'the selected role'}.`,
      );
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The invitation could not be sent.');
    } finally {
      setPending(false);
    }
  }

  const inviteRoles = roles.filter((role) => role.key !== 'owner');

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section aria-labelledby="invite-member-heading" className="material-card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold" id="invite-member-heading">
            Invite a teammate
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Choose their organisation role now. It takes effect when they accept the email
            invitation.
          </p>
        </div>
        {error ? (
          <p className="text-sm text-danger-fg" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <output className="text-sm text-success-fg">{message}</output> : null}
        <form className="space-y-4" onSubmit={(event) => void invite(event)}>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-email`}>
              Work email
            </label>
            <Input
              autoComplete="email"
              className="w-full"
              id={`${id}-email`}
              name="email"
              required
              type="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-role`}>
              Role after acceptance
            </label>
            <SelectControl
              className="w-full"
              disabled={loading || inviteRoles.length === 0}
              id={`${id}-role`}
              name="roleKey"
              required
            >
              <option value="">Choose a role</option>
              {inviteRoles.map((role) => (
                <option key={role.id} value={role.key}>
                  {role.name}
                </option>
              ))}
            </SelectControl>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={pending || loading || inviteRoles.length === 0}
              type="submit"
              variant="primary"
            >
              {pending ? 'Sending invitation…' : 'Send invitation'}
            </Button>
            <span className="text-sm text-fg-muted">Invitation links expire after 7 days.</span>
          </div>
        </form>
        {canManageRoles ? (
          <p className="text-sm text-fg-muted">
            Need a tailored permission set?{' '}
            <Link className="text-brand-fg underline" href="/roles">
              Create or review roles
            </Link>
            .
          </p>
        ) : null}
      </section>
      <section aria-labelledby="team-invitations-heading" className="material-card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold" id="team-invitations-heading">
            Invitations
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Track outstanding invitations and revoke links that should no longer work.
          </p>
        </div>
        <PendingInvitations key={refreshKey} />
      </section>
      <div className="xl:col-span-2">
        <TeamRoster
          canManageRoles={canManageRoles}
          key={refreshKey}
          onUpdated={() => setRefreshKey((current) => current + 1)}
          roles={roles}
        />
      </div>
    </div>
  );
}
