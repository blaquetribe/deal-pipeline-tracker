'use client';

import {
  customRoleBodySchema,
  type TenantRole,
  type TenantRolesCatalogResponse,
} from '@dpt/shared';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { createCustomRole, readRoleCatalog, updateCustomRole } from './api';

type RoleDraft = {
  readonly id: string | null;
  readonly name: string;
  readonly permissions: string[];
};

function emptyDraft(): RoleDraft {
  return { id: null, name: '', permissions: [] };
}

function roleDescription(role: TenantRole): string {
  return role.permissions.length === 0
    ? 'No permissions'
    : `${role.permissions.length} permissions`;
}

export function RoleManagement() {
  const id = useId();
  const [catalog, setCatalog] = useState<TenantRolesCatalogResponse | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadCatalog = useCallback(async (clearError = true): Promise<boolean> => {
    if (clearError) setError(null);
    try {
      setCatalog(await readRoleCatalog());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Roles could not be loaded.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readRoleCatalog()
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Roles could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function editRole(role: TenantRole) {
    setDraft({ id: role.id, name: role.name, permissions: [...role.permissions] });
    setError(null);
    setMessage(null);
  }

  function togglePermission(permission: string) {
    setDraft((current) => {
      if (!current) return current;
      const permissions = new Set(current.permissions);
      if (permissions.has(permission)) permissions.delete(permission);
      else permissions.add(permission);
      return { ...current, permissions: [...permissions].toSorted() };
    });
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const parsed = customRoleBodySchema.safeParse({
      name: draft.name,
      permissions: draft.permissions,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the role name and permissions.');
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (draft.id) await updateCustomRole(draft.id, parsed.data);
      else await createCustomRole(parsed.data);
      setDraft(null);
      const refreshed = await loadCatalog(false);
      if (refreshed) setMessage(draft.id ? 'Role updated.' : 'Custom role created.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The role could not be saved.');
    } finally {
      setPending(false);
    }
  }

  if (loading) return <output aria-busy="true">Loading roles…</output>;

  return (
    <section className="space-y-6">
      {error && (
        <p
          className="rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && <output className="text-sm text-success-fg">{message}</output>}

      {catalog && !catalog.canManageRoles && (
        <p className="rounded-control border border-line bg-surface-raised p-4 text-sm text-fg-muted">
          You can view the roles in this organisation. An Owner with role management access can
          create or edit custom roles.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Organisation roles</h2>
          <p className="mt-1 text-sm text-fg-muted">
            System roles are fixed. Custom role changes are checked against separation-of-duties
            rules before they apply.
          </p>
        </div>
        {catalog?.canManageRoles && !draft && (
          <Button
            onClick={() => {
              setDraft(emptyDraft());
              setError(null);
              setMessage(null);
            }}
            type="button"
            variant="primary"
          >
            Create custom role
          </Button>
        )}
      </div>

      {catalog && (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Roles">
          {catalog.roles.map((role) => (
            <li className="material-card flex flex-col gap-3 p-4" key={role.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{role.name}</h3>
                  <p className="text-sm text-fg-muted">
                    {role.isSystem ? 'System role' : 'Custom role'} · {roleDescription(role)}
                  </p>
                </div>
                {!role.isSystem && catalog.canManageRoles && (
                  <Button
                    aria-label={`Edit ${role.name}`}
                    className="text-sm"
                    onClick={() => editRole(role)}
                    size="small"
                    type="button"
                    variant="secondary"
                  >
                    Edit
                  </Button>
                )}
              </div>
              <ul className="flex flex-wrap gap-2" aria-label={`${role.name} permissions`}>
                {role.permissions.map((permission) => (
                  <li
                    className="rounded-control bg-surface-raised px-2 py-1 text-xs text-fg-muted"
                    key={permission}
                  >
                    {catalog.permissionCatalog.find(({ key }) => key === permission)?.description ??
                      permission}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {draft && catalog?.canManageRoles && (
        <form className="material-card space-y-5 p-5" onSubmit={(event) => void saveRole(event)}>
          <h2 className="text-lg font-semibold">
            {draft.id ? 'Edit custom role' : 'Create custom role'}
          </h2>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-name`}>
              Role name
            </label>
            <Input
              autoComplete="off"
              className="w-full sm:max-w-lg"
              id={`${id}-name`}
              maxLength={100}
              onChange={(event) =>
                setDraft((current) => current && { ...current, name: event.target.value })
              }
              required
              value={draft.name}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Permissions</legend>
            <p className="mt-1 mb-3 text-sm text-fg-muted">
              A role must include at least one permission. The database rejects combinations that
              violate separation of duties.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {catalog.permissionCatalog.map((permission) => (
                <li key={permission.key}>
                  <label
                    className="flex items-start gap-3 rounded-control border border-line p-3 hover:bg-surface-hover"
                    htmlFor={`${id}-permission-${permission.key.replaceAll('.', '-')}`}
                  >
                    <input
                      aria-label={permission.description}
                      checked={draft.permissions.includes(permission.key)}
                      className="mt-1 accent-brand"
                      id={`${id}-permission-${permission.key.replaceAll('.', '-')}`}
                      onChange={() => togglePermission(permission.key)}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-medium">{permission.description}</span>
                      <span className="block text-xs text-fg-muted">{permission.key}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending} type="submit" variant="primary">
              {pending ? 'Saving…' : draft.id ? 'Save role' : 'Create role'}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
