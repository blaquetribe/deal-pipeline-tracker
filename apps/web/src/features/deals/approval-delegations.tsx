'use client';

import type { ApprovalDelegation } from '@dpt/shared';
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';

import {
  cancelApprovalDelegation,
  readApprovalDelegations,
  readEligibleApprovalDelegates,
  setApprovalDelegation,
} from './api';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function ApprovalDelegations() {
  const delegateId = useId();
  const startsId = useId();
  const endsId = useId();
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof readEligibleApprovalDelegates>>>(
    [],
  );
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [delegate, setDelegate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [records, eligible] = await Promise.all([
      readApprovalDelegations(),
      readEligibleApprovalDelegates(),
    ]);
    setDelegations(records);
    setOptions(eligible);
    setDelegate((current) => current || eligible[0]?.membershipId || '');
  }

  useEffect(() => {
    let active = true;
    void Promise.all([readApprovalDelegations(), readEligibleApprovalDelegates()])
      .then(([records, eligible]) => {
        if (!active) return;
        setDelegations(records);
        setOptions(eligible);
        setDelegate(eligible[0]?.membershipId ?? '');
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Delegations could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!delegate || !startsAt || !endsAt) return;
    setBusy(true);
    setError(null);
    try {
      await setApprovalDelegation(
        delegate,
        new Date(startsAt).toISOString(),
        new Date(endsAt).toISOString(),
      );
      setStartsAt('');
      setEndsAt('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The delegation could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(delegationId: string) {
    setBusy(true);
    setError(null);
    try {
      await cancelApprovalDelegation(delegationId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The delegation could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="approval-delegations-title"
      className="mt-5 border-t border-line pt-4"
    >
      <h3 className="font-semibold" id="approval-delegations-title">
        Approval delegation
      </h3>
      <p className="mt-1 text-sm text-fg-muted">
        Schedule a temporary proxy for your approval slot. A delegate uses your slot and cannot add
        an extra vote.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="mt-3 text-sm text-fg-muted">Loading delegations…</p> : null}
      {!loading && delegations.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {delegations.map((record) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-3 text-sm"
              key={record.id}
            >
              <span>
                {record.delegatorName ?? 'Unnamed member'} →{' '}
                {record.delegateName ?? 'Unnamed member'}
                <span className="block text-fg-muted">
                  {formatDate(record.startsAt)} – {formatDate(record.endsAt)}
                  {record.active ? ' · Active' : ' · Scheduled'}
                </span>
              </span>
              {record.canCancel ? (
                <button
                  className="rounded-control border border-line px-3 py-1.5 focus-visible:outline-2 disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void cancel(record.id)}
                  type="button"
                >
                  Revoke delegation
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!loading && options.length === 0 && delegations.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          No eligible delegates are available. Delegation must be enabled by an Owner, and eligible
          members must have approval access.
        </p>
      ) : null}
      {!loading && options.length > 0 ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => void submit(event)}
        >
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={delegateId}>
              Delegate
            </label>
            <select
              className="min-w-48 rounded-control border border-line bg-surface p-2 outline-focus focus-visible:outline-2"
              id={delegateId}
              onChange={(event) => setDelegate(event.currentTarget.value)}
              required
              value={delegate}
            >
              {options.map((option) => (
                <option key={option.membershipId} value={option.membershipId}>
                  {option.displayName ?? 'Unnamed member'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={startsId}>
              Starts
            </label>
            <input
              className="rounded-control border border-line bg-surface p-2 outline-focus focus-visible:outline-2"
              id={startsId}
              onChange={(event) => setStartsAt(event.currentTarget.value)}
              required
              type="datetime-local"
              value={startsAt}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={endsId}>
              Ends
            </label>
            <input
              className="rounded-control border border-line bg-surface p-2 outline-focus focus-visible:outline-2"
              id={endsId}
              min={startsAt || undefined}
              onChange={(event) => setEndsAt(event.currentTarget.value)}
              required
              type="datetime-local"
              value={endsAt}
            />
          </div>
          <button
            className="rounded-control border border-line px-4 py-2 focus-visible:outline-2 disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Saving…' : 'Schedule delegation'}
          </button>
        </form>
      ) : null}
    </section>
  );
}
