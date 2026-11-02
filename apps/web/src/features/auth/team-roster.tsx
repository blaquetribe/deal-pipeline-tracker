'use client';

import type { AssignableRole, TeamMember } from '@dpt/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { subscribeToDealsChanged } from '../notifications';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
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

function memberInitials(member: TeamMember): string {
  return memberName(member)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? '')
    .join('');
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
    const refresh = () => {
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
    };
    refresh();
    const unsubscribe = subscribeToDealsChanged(refresh);
    return () => {
      active = false;
      unsubscribe();
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
    <section aria-labelledby="team-roster-heading" className="material-card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold" id="team-roster-heading">
          Active and deactivated members
        </h2>
        <p className="text-xs text-fg-muted">
          Update roles or remove organisation access. Your own roles are protected.
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
      <ul className="grid gap-1.5">
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
              className="grid gap-x-4 gap-y-2.5 rounded-control border border-line bg-surface-subtle p-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-center xl:grid-cols-[minmax(14rem,1.2fr)_minmax(13rem,1fr)_minmax(20rem,1.6fr)]"
              key={member.userId}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-fg"
                >
                  {memberInitials(member)}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="truncate text-sm font-semibold text-fg">{memberName(member)}</h3>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[0.65rem] leading-tight font-medium ${isDeactivated ? 'bg-danger-soft text-danger-fg' : isSelf ? 'bg-brand-soft text-brand-fg' : 'bg-surface-muted text-fg-muted'}`}
                    >
                      {isDeactivated ? 'Deactivated' : isSelf ? 'You' : 'Active'}
                    </span>
                  </div>
                  {member.email ? (
                    <p className="truncate text-xs text-fg-muted" title={member.email}>
                      {member.email}
                    </p>
                  ) : null}
                </div>
              </div>
              <ul
                aria-label={`${memberName(member)} roles`}
                className="flex min-w-0 flex-wrap items-center gap-1.5 md:justify-end xl:justify-start"
              >
                {member.roles.map((role) => (
                  <li
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium"
                    key={role.key}
                  >
                    {role.name}
                    {!isSelf &&
                    !isDeactivated &&
                    member.roles.length > 1 &&
                    (canManageRoles || !isPrivilegedRole(role.key)) ? (
                      <Button
                        aria-label={`Remove ${role.name} from ${memberName(member)}`}
                        className="team-role-remove"
                        disabled={pendingUserId !== null}
                        onClick={() => void revoke(member, role.key)}
                        size="small"
                        type="button"
                        variant="secondary"
                      >
                        <Icon className="size-3.5" name="remove" />
                      </Button>
                    ) : null}
                  </li>
                ))}
                {member.roles.length === 0 ? (
                  <li className="text-sm text-fg-muted">No roles assigned</li>
                ) : null}
              </ul>
              {!isSelf && !isDeactivated && canManageMember ? (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 md:col-span-2 xl:col-span-1 xl:justify-end">
                  {assignable.length > 0 ? (
                    <form
                      className="flex min-w-0 flex-wrap items-center gap-1.5"
                      onSubmit={(event) => void grant(event, member)}
                    >
                      <label className="sr-only" htmlFor={rowId}>
                        Add role to {memberName(member)}
                      </label>
                      <SelectControl className="w-40 max-w-full" id={rowId} name="roleKey" required>
                        <option value="">Add role…</option>
                        {assignable.map((role) => (
                          <option key={role.key} value={role.key}>
                            {role.name}
                          </option>
                        ))}
                      </SelectControl>
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
                    <p className="text-xs text-fg-muted">No additional roles available.</p>
                  )}
                  {confirmDeactivateId === member.userId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-danger-fg">
                        This will remove their organisation access.
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
                <p className="text-xs text-fg-muted md:col-span-2 xl:col-span-3">
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
