'use client';

import type { Deal, DealActivityResponse } from '@dpt/shared';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';

import { StageBadge } from '../pipeline';
import { postDealNote, readDeal, readDealActivity } from './api';
import { formatMinorAmount } from './money';

async function loadDealData(dealId: string) {
  return Promise.all([readDeal(dealId), readDealActivity(dealId)]);
}

interface DealDetailProps {
  readonly dealId: string;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function DealDetail({ dealId }: DealDetailProps) {
  const noteId = useId();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [activity, setActivity] = useState<DealActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDealData(dealId)
      .then(([detail, events]) => {
        if (!active) return;
        setDeal(detail);
        setActivity(events);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Deal details could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [dealId]);

  async function reload() {
    setError(null);
    setDeal(null);
    setActivity(null);
    try {
      const [detail, events] = await loadDealData(dealId);
      setDeal(detail);
      setActivity(events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deal details could not be loaded.');
    }
  }

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = data.get('body');
    if (typeof body !== 'string') return;
    setNoteError(null);
    setPosting(true);
    try {
      await postDealNote(dealId, body);
      form.reset();
      const [detail, events] = await loadDealData(dealId);
      setDeal(detail);
      setActivity(events);
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : 'The note could not be saved.');
    } finally {
      setPosting(false);
    }
  }

  async function loadOlderActivity() {
    const beforeSeq = activity?.events.at(-1)?.seq;
    if (!activity?.hasMore || !beforeSeq || loadingOlder) return;
    setLoadingOlder(true);
    setActivityError(null);
    try {
      const older = await readDealActivity(dealId, { beforeSeq });
      setActivity((current) =>
        current
          ? {
              ...current,
              events: [...current.events, ...older.events],
              hasMore: older.hasMore,
              integrityOk: older.integrityOk,
            }
          : older,
      );
    } catch (cause) {
      setActivityError(
        cause instanceof Error ? cause.message : 'Older activity could not be loaded.',
      );
    } finally {
      setLoadingOlder(false);
    }
  }

  if (error) {
    return (
      <section aria-labelledby="deal-detail-title" className="mt-8">
        <h1 className="text-2xl font-semibold" id="deal-detail-title">
          Deal details
        </h1>
        <p className="mt-4" role="alert">
          {error}
        </p>
        <button
          className="mt-4 rounded-control border border-line px-4 py-2 focus-visible:outline-2"
          onClick={() => void reload()}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!deal || !activity) {
    return (
      <p aria-busy="true" className="mt-8 text-fg-muted">
        Loading deal details…
      </p>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      <header>
        <Link className="text-sm text-fg-muted underline focus-visible:outline-2" href="/">
          Back to deals
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">{deal.name}</h1>
        <div className="mt-3">
          <StageBadge stage={deal.stage} />
        </div>
      </header>

      <section
        aria-labelledby="overview-title"
        className="rounded-panel border border-line bg-surface-raised p-5"
      >
        <h2 className="text-xl font-semibold" id="overview-title">
          Overview
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-fg-muted">Sector</dt>
            <dd>{deal.sector ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Deal size</dt>
            <dd>
              {deal.amount === null ? 'Not set' : formatMinorAmount(deal.amount, deal.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Expected close</dt>
            <dd>
              {deal.expected_close_date ?? 'Not set'}
              {deal.expected_close_time ? ` at ${deal.expected_close_time.slice(0, 5)}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Created</dt>
            <dd>
              <time dateTime={deal.created_at}>{formatDate(deal.created_at)}</time>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="activity-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold" id="activity-title">
            Activity
          </h2>
          <output className="text-sm">
            {activity.integrityOk
              ? 'Activity integrity verified'
              : 'Activity integrity check failed'}
          </output>
        </div>
        <form
          className="mt-4 rounded-panel border border-line bg-surface-raised p-4"
          onSubmit={(event) => void submitNote(event)}
        >
          <label className="mb-2 block text-sm font-medium" htmlFor={noteId}>
            Add a note
          </label>
          <textarea
            className="min-h-28 w-full rounded-control border border-line bg-surface p-3 outline-focus focus-visible:outline-2"
            id={noteId}
            maxLength={10000}
            name="body"
            required
          />
          {noteError ? (
            <p className="mt-2 text-danger" role="alert">
              {noteError}
            </p>
          ) : null}
          <button
            className="mt-3 rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
            disabled={posting}
            type="submit"
          >
            {posting ? 'Saving…' : 'Add note'}
          </button>
          <p className="mt-2 text-sm text-fg-muted">
            Notes are permanent audit records and cannot be edited or deleted.
          </p>
        </form>
        {activity.events.length === 0 ? (
          <p className="mt-4 text-fg-muted">No activity yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {activity.events.map((item) => (
              <li className="rounded-panel border border-line bg-surface-raised p-4" key={item.id}>
                <p className="font-medium">
                  {item.kind === 'note' ? 'Note' : item.kind.replaceAll('_', ' ')}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{item.body}</p>
                <p className="mt-3 text-sm text-fg-muted">
                  {item.actorName ?? item.actorEmail} ·{' '}
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </p>
              </li>
            ))}
          </ol>
        )}
        {activityError ? (
          <p className="mt-3 text-danger" role="alert">
            {activityError}
          </p>
        ) : null}
        {activity.hasMore ? (
          <button
            className="mt-4 rounded-control border border-line px-4 py-2 focus-visible:outline-2 disabled:opacity-60"
            disabled={loadingOlder}
            onClick={() => void loadOlderActivity()}
            type="button"
          >
            {loadingOlder ? 'Loading…' : 'Load older activity'}
          </button>
        ) : null}
      </section>
    </div>
  );
}
