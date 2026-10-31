'use client';

import type { AssignableRole, TeamMember } from '@dpt/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { SelectControl } from '../ui/select-control';
import {
  deactivateTeamMember,
  grantTeamMemberRole,
  readAuthSession,
  readTeamMembers,
  revokeTeamMemberRole,
} from './api';

function memberName(member: TeamMember): string {
  return member.fullName || member.email || 'Invited teammate';
}

export function TeamRoster({
  roles,
  canManageRoles,
  onUpdated,
}: {
  readonly roles: AssignableRole[];
  readonly canManageRoles: boolean;
  readonly onUpdated: () => void;
}) {
  const id = useId();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([readTeamMembers(), readAuthSession()])
      .then(([result, session]) => {
        if (!active) return;
        setMembers(result.members);
        setCurrentUserId(session.user.id);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Team members could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const grantableRoles = roles;
  const isPrivilegedRole = (roleKey: string) => !roles.some((role) => role.key === roleKey);

  async function grant(event: FormEvent<HTMLFormElement>, member: TeamMember) {
    event.preventDefault();
    const form = event.currentTarget;
    const roleKey = new FormData(form).get('roleKey');
    if (typeof roleKey !== 'string' || !roleKey) return;
    setPendingUserId(member.userId);
    setError(null);
    try {
      await grantTeamMemberRole(member.userId, { roleKey });
      form.reset();
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The role could not be assigned.');
    } finally {
      setPendingUserId(null);
    }
  }

  async function revoke(member: TeamMember, roleKey: string) {
    setPendingUserId(member.userId);
    setError(null);
    try {
      await revokeTeamMemberRole(member.userId, { roleKey });
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The role could not be removed.');
    } finally {
      setPendingUserId(null);
    }
  }

  async function deactivate(member: TeamMember) {
    setPendingUserId(member.userId);
    setError(null);
    try {
      await deactivateTeamMember(member.userId);
      setConfirmDeactivateId(null);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The member could not be deactivated.');
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <section aria-labelledby="team-roster-heading" className="material-card space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold" id="team-roster-heading">
          Active and deactivated members
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Review organisation roles, adjust access, or deactivate an account. Your own roles cannot
          be changed here.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-danger-fg" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <output>Loading team members…</output> : null}
      {!loading && members.length === 0 && !error ? (
        <p className="text-sm text-fg-muted">No organisation members were found.</p>
      ) : null}
      <ul className="grid gap-3">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const isDeactivated = member.deactivatedAt !== null;
          const canManageMember =
            canManageRoles || !member.roles.some((role) => isPrivilegedRole(role.key));
          const assignable = grantableRoles.filter(
            (role) => !member.roles.some((currentRole) => currentRole.key === role.key),
          );
          const rowId = `${id}-${member.userId}`;
          return (
            <li
              className="rounded-control border border-line bg-surface-subtle p-4"
              key={member.userId}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-fg">{memberName(member)}</h3>
                  {member.email ? (
                    <p className="mt-1 text-sm break-all text-fg-muted">{member.email}</p>
                  ) : null}
                </div>
                <span className="rounded-full border border-line px-3 py-1 text-xs font-medium">
                  {isDeactivated ? 'Deactivated' : isSelf ? 'You' : 'Active'}
                </span>
              </div>
              <ul aria-label={`${memberName(member)} roles`} className="mt-3 flex flex-wrap gap-2">
                {member.roles.map((role) => (
                  <li
                    className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm"
                    key={role.key}
                  >
                    {role.name}
                    {!isSelf &&
                    !isDeactivated &&
                    member.roles.length > 1 &&
                    (canManageRoles || !isPrivilegedRole(role.key)) ? (
                      <Button
                        aria-label={`Remove ${role.name} from ${memberName(member)}`}
                        disabled={pendingUserId !== null}
                        onClick={() => void revoke(member, role.key)}
                        size="small"
                        type="button"
                        variant="secondary"
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
                {member.roles.length === 0 ? (
                  <li className="text-sm text-fg-muted">No roles assigned</li>
                ) : null}
              </ul>
              {!isSelf && !isDeactivated && canManageMember ? (
                <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                  {assignable.length > 0 ? (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(event) => void grant(event, member)}
                    >
                      <div>
                        <label className="mb-1 block text-xs font-medium" htmlFor={rowId}>
                          Add role
                        </label>
                        <SelectControl className="min-w-48" id={rowId} name="roleKey" required>
                          <option value="">Choose a role</option>
                          {assignable.map((role) => (
                            <option key={role.key} value={role.key}>
                              {role.name}
                            </option>
                          ))}
                        </SelectControl>
                      </div>
                      <Button
                        disabled={pendingUserId !== null}
                        size="small"
                        type="submit"
                        variant="secondary"
                      >
                        Add role
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm text-fg-muted">No additional roles available.</p>
                  )}
                  {confirmDeactivateId === member.userId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-fg-muted">
                        Remove this member’s organisation access?
                      </span>
                      <Button
                        disabled={pendingUserId !== null}
                        onClick={() => void deactivate(member)}
                        size="small"
                        type="button"
                        variant="danger"
                      >
                        Confirm deactivate
                      </Button>
                      <Button
                        disabled={pendingUserId !== null}
                        onClick={() => setConfirmDeactivateId(null)}
                        size="small"
                        type="button"
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      disabled={pendingUserId !== null}
                      onClick={() => setConfirmDeactivateId(member.userId)}
                      size="small"
                      type="button"
                      variant="danger"
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              ) : null}
              {!isSelf && !isDeactivated && !canManageMember ? (
                <p className="mt-3 text-sm text-fg-muted">
                  Only an Owner can change access for a member with privileged roles.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
