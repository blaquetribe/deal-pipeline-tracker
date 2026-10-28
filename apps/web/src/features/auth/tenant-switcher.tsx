'use client';

import { tenantChoicesResponseSchema, type TenantChoicesResponse } from '@dpt/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { sessionRead, sessionRequest } from './api';

export function TenantSwitcher() {
  const id = useId();
  const router = useRouter();
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
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Organisation could not be changed.');
    } finally {
      setPending(false);
    }
  }

  if (
    !choices ||
    choices.tenants.length === 0 ||
    (choices.tenants.length < 2 && choices.activeTenantId)
  ) {
    return error ? (
      <p className="text-sm text-danger-fg" role="alert">
        {error}
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        Organisation
      </label>
      <select
        className="rounded-control border border-line bg-surface-raised px-3 py-2 text-sm text-fg outline-focus focus-visible:outline-2 disabled:opacity-60"
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
      </select>
      {error && (
        <p className="text-sm text-danger-fg" role="alert">
          {error}
        </p>
      )}
      {pending && <output className="text-sm text-fg-muted">Switching…</output>}
    </div>
  );
}
