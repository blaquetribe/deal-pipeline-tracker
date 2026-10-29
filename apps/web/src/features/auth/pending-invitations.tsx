'use client';

import { pendingInvitationsResponseSchema, type PendingInvitationsResponse } from '@dpt/shared';
import { useEffect, useState } from 'react';

import { Button } from '../ui/button';
import { sessionRead, sessionRequest } from './api';

export function PendingInvitations() {
  const [invitations, setInvitations] = useState<PendingInvitationsResponse['invitations']>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = pendingInvitationsResponseSchema.parse(
      await sessionRead('/onboarding/invitations'),
    );
    setInvitations(result.invitations);
  }

  useEffect(() => {
    let active = true;
    void sessionRead('/onboarding/invitations')
      .then((value) => {
        const result = pendingInvitationsResponseSchema.parse(value);
        if (active) setInvitations(result.invitations);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Invitations could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function revoke(invitationId: string) {
    setError(null);
    setPendingId(invitationId);
    try {
      await sessionRequest('/onboarding/invitations', 'DELETE', { invitationId });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The invitation could not be revoked.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="pending-invitations-heading" className="space-y-3">
      <h3 className="font-medium" id="pending-invitations-heading">
        Pending invitations
      </h3>
      {error && (
        <p className="text-sm text-danger-fg" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <output>Loading invitations…</output>
      ) : invitations.length === 0 ? (
        <p className="text-sm text-fg-muted">No pending invitations.</p>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line">
          {invitations.map((invitation) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 p-3"
              key={invitation.invitationId}
            >
              <div>
                <p className="font-medium">{invitation.email}</p>
                <p className="text-sm text-fg-muted">
                  {invitation.roleKey.replaceAll('_', ' ')} · Expires{' '}
                  <time dateTime={invitation.expiresAt}>
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </time>
                </p>
              </div>
              <Button
                className="text-sm"
                disabled={pendingId !== null}
                onClick={() => void revoke(invitation.invitationId)}
                size="small"
                type="button"
                variant="danger"
              >
                {pendingId === invitation.invitationId ? 'Revoking…' : 'Revoke'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
