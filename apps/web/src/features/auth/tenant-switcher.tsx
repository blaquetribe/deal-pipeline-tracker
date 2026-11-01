'use client';

import { tenantChoicesResponseSchema, type TenantChoicesResponse } from '@dpt/shared';
import { useEffect, useId, useState } from 'react';

import { SelectControl } from '../ui/select-control';
import { sessionRead, sessionRequest } from './api';
import { reloadCurrentPage } from './navigation';

export function TenantSwitcher() {
  const id = useId();
  const [choices, setChoices] = useState<TenantChoicesResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void sessionRead('/auth/tenants')
      .then((value) => {
        const parsed = tenantChoicesResponseSchema.parse(value);
        if (active) setChoices(parsed);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Organisations could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function change(tenantId: string) {
    if (!tenantId || tenantId === choices?.activeTenantId) return;
    setError(null);
    setPending(true);
    try {
      await sessionRequest('/auth/tenant', 'POST', { tenantId });
      setChoices((current) => (current ? { ...current, activeTenantId: tenantId } : current));
      reloadCurrentPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Organisation could not be changed.');
    } finally {
      setPending(false);
    }
  }

  if (!choices || choices.tenants.length === 0) {
    return error ? (
      <p className="text-sm text-danger-fg" role="alert">
        {error}
      </p>
    ) : null;
  }

  if (choices.tenants.length === 1 && choices.activeTenantId) {
    const activeTenant = choices.tenants[0];
    if (!activeTenant) return null;
    return (
      <div aria-label="Active organisation" className="flex min-w-0 items-baseline gap-2">
        <p className="shrink-0 text-[0.65rem] font-semibold tracking-[0.1em] text-fg-subtle uppercase">
          Organisation
        </p>
        <p className="max-w-56 truncate text-sm font-semibold text-fg">{activeTenant.tenantName}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        Organisation
      </label>
      <SelectControl
        className="disabled:opacity-60"
        disabled={pending}
        id={id}
        onChange={(event) => void change(event.currentTarget.value)}
        value={choices.activeTenantId ?? ''}
      >
        {!choices.activeTenantId && <option value="">Choose an organisation</option>}
        {choices.tenants.map((tenant) => (
          <option key={tenant.tenantId} value={tenant.tenantId}>
            {tenant.tenantName}
          </option>
        ))}
      </SelectControl>
      {error && (
        <p className="text-sm text-danger-fg" role="alert">
          {error}
        </p>
      )}
      {pending && <output className="text-sm text-fg-muted">Switching…</output>}
    </div>
  );
}
