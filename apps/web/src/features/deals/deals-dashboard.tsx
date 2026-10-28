'use client';

import {
  createDealBodySchema,
  evaluateMove,
  STAGES,
  STAGE_LABELS,
  STAGE_TRANSITIONS,
  stageSchema,
  updateDealBodySchema,
  daysUntil,
  formatCloseCountdown,
  type DashboardSummary,
  type DealListResponse,
  type Stage,
} from '@dpt/shared';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { StageBadge } from '../pipeline';
import { createDeal, moveDealStage, readDashboardSummary, readDeals, updateDeal } from './api';
import { formatMinorAmount, majorAmountForInput, parseMajorAmount } from './money';

const PAGE_SIZE = 25;

function formatCloseDate(date: string | null): string {
  if (!date) return 'Not set';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function DealsDashboard() {
  const searchId = useId();
  const stageId = useId();
  const dealNameId = useId();
  const sectorId = useId();
  const amountId = useId();
  const currencyId = useId();
  const closeDateId = useId();
  const createForm = useRef<HTMLDetailsElement>(null);
  const [stage, setStage] = useState<Stage | ''>('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<DealListResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [moveTargets, setMoveTargets] = useState<Record<string, Stage | ''>>({});
  const [movingDeal, setMovingDeal] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const [updatingDeal, setUpdatingDeal] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (stage) query.set('stage', stage);
    if (appliedSearch) query.set('search', appliedSearch);
    void readDeals(query)
      .then((response) => {
        if (active) setResult(response);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Deals could not be loaded.');
          setResult(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [appliedSearch, offset, stage]);

  useEffect(() => {
    let active = true;
    void readDashboardSummary()
      .then((response) => {
        if (active) {
          setSummary(response);
          setSummaryError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setSummaryError(
            cause instanceof Error ? cause.message : 'Pipeline summary could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!summary) return undefined;
    const serverOffsetMs = Date.parse(summary.serverNow) - Date.now();
    let timer: number | undefined;
    const schedule = () => {
      if (document.hidden) return;
      const now = Date.now() + serverOffsetMs;
      const withinMinuteWindow = summary.closingSoon.some((deal) => {
        if (!deal.closesAt) return false;
        const timeLeft = Date.parse(deal.closesAt) - now;
        return timeLeft > 0 && timeLeft <= 86_400_000;
      });
      const boundaryDelay = withinMinuteWindow
        ? 60_000 - (now % 60_000)
        : Date.parse(summary.nextMidnightAt) - now;
      timer = window.setTimeout(
        () => {
          const updatedNow = Date.now() + serverOffsetMs;
          setClockNow(new Date(updatedNow));
          if (!withinMinuteWindow && updatedNow >= Date.parse(summary.nextMidnightAt)) {
            void refreshSummary();
            return;
          }
          schedule();
        },
        Math.max(500, boundaryDelay),
      );
    };
    const onVisibility = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!document.hidden) {
        const updatedNow = Date.now() + serverOffsetMs;
        setClockNow(new Date(updatedNow));
        if (updatedNow >= Date.parse(summary.nextMidnightAt)) void refreshSummary();
        else schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [summary]);

  async function refreshSummary() {
    try {
      setSummary(await readDashboardSummary());
      setSummaryError(null);
    } catch (cause) {
      setSummaryError(
        cause instanceof Error ? cause.message : 'Pipeline summary could not be loaded.',
      );
    }
  }

  async function submitDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setCreateError(null);
    setCreateMessage(null);
    setCreating(true);
    const form = new FormData(formElement);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    try {
      const currency = field('currency').trim().toUpperCase() || 'ZAR';
      const body = createDealBodySchema.parse({
        name: field('name'),
        sector: field('sector').trim() || null,
        amount: parseMajorAmount(field('amount'), currency),
        currency,
        expectedCloseDate: field('expectedCloseDate') || null,
      });
      await createDeal(body);
      formElement.reset();
      setCreateMessage('Deal created.');
      setLoading(true);
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (stage) query.set('stage', stage);
      if (appliedSearch) query.set('search', appliedSearch);
      const refreshed = await readDeals(query);
      setResult(refreshed);
      void refreshSummary();
      setLoading(false);
      if (createForm.current) createForm.current.open = false;
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'The deal could not be created.');
    } finally {
      setCreating(false);
    }
  }

  async function moveStage(dealId: string) {
    const deal = result?.items.find((item) => item.id === dealId);
    const toStage = moveTargets[dealId];
    if (!deal || !toStage) return;
    setMoveNotice(null);
    setMovingDeal(dealId);
    try {
      await moveDealStage(deal.id, toStage, deal.version);
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (stage) query.set('stage', stage);
      if (appliedSearch) query.set('search', appliedSearch);
      const refreshed = await readDeals(query);
      setResult(refreshed);
      void refreshSummary();
      setMoveTargets((current) => ({ ...current, [dealId]: '' }));
      setMoveNotice(`${deal.name} moved to ${STAGE_LABELS[toStage]}.`);
    } catch (cause) {
      setMoveNotice(
        cause instanceof Error ? cause.message : 'The deal stage could not be changed.',
      );
    } finally {
      setMovingDeal(null);
    }
  }

  async function submitUpdate(
    event: FormEvent<HTMLFormElement>,
    deal: DealListResponse['items'][number],
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    setUpdateNotice(null);
    setUpdatingDeal(deal.id);
    try {
      const name = field('name').trim();
      const sector = field('sector').trim() || null;
      const currency = field('currency').trim().toUpperCase();
      const amount = parseMajorAmount(field('amount'), currency);
      const expectedCloseDate = field('expectedCloseDate') || null;
      const expectedCloseTime = field('expectedCloseTime') || null;
      const changes: Record<string, unknown> = {};
      if (name !== deal.name) changes.name = name;
      if (sector !== deal.sector) changes.sector = sector;
      if (currency !== deal.currency) changes.currency = currency;
      if (amount !== deal.amount) changes.amount = amount;
      if (expectedCloseDate !== deal.expected_close_date) {
        changes.expectedCloseDate = expectedCloseDate;
      }
      if (expectedCloseTime !== (deal.expected_close_time?.slice(0, 5) ?? null)) {
        changes.expectedCloseTime = expectedCloseTime;
      }
      const body = updateDealBodySchema.parse({ expectedVersion: deal.version, ...changes });
      await updateDeal(deal.id, body);
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (stage) query.set('stage', stage);
      if (appliedSearch) query.set('search', appliedSearch);
      setResult(await readDeals(query));
      void refreshSummary();
      setUpdateNotice(`${deal.name} updated.`);
      const details = formElement.closest('details');
      if (details) details.open = false;
    } catch (cause) {
      setUpdateNotice(cause instanceof Error ? cause.message : 'The deal could not be updated.');
    } finally {
      setUpdatingDeal(null);
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = search.trim();
    if (nextSearch !== appliedSearch || offset !== 0) {
      setLoading(true);
      setError(null);
      setOffset(0);
      setAppliedSearch(nextSearch);
    }
  }

  function changeStage(value: string) {
    const parsed = value === '' ? null : stageSchema.safeParse(value);
    const nextStage: Stage | '' = parsed === null ? '' : parsed.success ? parsed.data : stage;
    if (nextStage !== stage || offset !== 0) {
      setLoading(true);
      setError(null);
      setStage(nextStage);
      setOffset(0);
    }
  }

  return (
    <section aria-labelledby="deals-title" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold" id="deals-title">
            Deals
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Review opportunities across your organisation.
          </p>
        </div>
        <p aria-live="polite" className="text-sm text-fg-muted">
          {loading
            ? 'Loading deals…'
            : `${result?.total ?? 0} ${result?.total === 1 ? 'deal' : 'deals'}`}
        </p>
      </div>

      <section aria-labelledby="pipeline-overview-title" className="mt-6 space-y-4">
        <h3 className="text-xl font-semibold" id="pipeline-overview-title">
          Pipeline overview
        </h3>
        {summaryError ? (
          <div
            className="rounded-panel border border-danger/40 bg-danger-soft p-4 text-danger-fg"
            role="alert"
          >
            <p>{summaryError}</p>
            <button
              className="mt-2 underline focus-visible:outline-2"
              onClick={() => void refreshSummary()}
              type="button"
            >
              Retry summary
            </button>
          </div>
        ) : summary ? (
          <div aria-busy={false} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-panel border border-line bg-surface-raised p-4">
                <h4 className="text-sm text-fg-muted">Open pipeline value</h4>
                <ul className="mt-2 space-y-1 font-semibold tabular-nums">
                  {summary.totalsByCurrency.length ? (
                    summary.totalsByCurrency.map((total) => (
                      <li key={total.currency}>
                        {formatMinorAmount(total.amount, total.currency)}
                      </li>
                    ))
                  ) : (
                    <li>No valued open deals</li>
                  )}
                </ul>
              </article>
              <article className="rounded-panel border border-line bg-surface-raised p-4">
                <h4 className="text-sm text-fg-muted">Closing soon</h4>
                <p className="mt-2 text-2xl font-semibold">{summary.closingSoonCount}</p>
                <p className="text-sm text-fg-muted">
                  Within {summary.windowDays} days, including overdue deals
                </p>
              </article>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <section
                aria-labelledby="stage-overview-title"
                className="rounded-panel border border-line bg-surface-raised p-4"
              >
                <h4 className="font-semibold" id="stage-overview-title">
                  Deals by stage
                </h4>
                <ul className="mt-3 divide-y divide-line">
                  {summary.pipelineByStage.map((item) => (
                    <li className="flex justify-between gap-3 py-2" key={item.stage}>
                      <span>{STAGE_LABELS[item.stage]}</span>
                      <span className="tabular-nums">{item.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section
                aria-labelledby="closing-soon-title"
                className="rounded-panel border border-line bg-surface-raised p-4"
              >
                <h4 className="font-semibold" id="closing-soon-title">
                  Closing soon
                </h4>
                {summary.closingSoon.length === 0 ? (
                  <p className="mt-3 text-sm text-fg-muted">
                    No active deals have an expected close date in this window.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {summary.closingSoon.map((deal) => {
                      const now = clockNow ?? new Date(summary.serverNow);
                      const currentDays = clockNow
                        ? daysUntil(deal.expectedCloseDate, clockNow, summary.timeZone)
                        : deal.closesInDays;
                      const urgent = currentDays <= 5;
                      return (
                        <li
                          className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
                          key={deal.id}
                        >
                          <div>
                            <Link
                              className="font-medium underline focus-visible:outline-2"
                              href={`/deals/${deal.id}`}
                            >
                              {deal.name}
                            </Link>
                            <p className="text-sm text-fg-muted">
                              {STAGE_LABELS[deal.stage]} · {formatCloseDate(deal.expectedCloseDate)}
                            </p>
                          </div>
                          <p
                            className={
                              urgent
                                ? 'rounded-control border border-danger/40 bg-danger-soft px-3 py-1 text-sm font-medium text-danger-fg'
                                : 'rounded-control border border-line px-3 py-1 text-sm'
                            }
                          >
                            {formatCloseCountdown(
                              currentDays,
                              deal.closesAt,
                              now,
                              summary.timeZone,
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {summary.closingSoonCount > summary.closingSoon.length ? (
                  <p className="mt-3 text-sm text-fg-muted">Showing the 10 nearest close dates.</p>
                ) : null}
              </section>
            </div>
          </div>
        ) : (
          <p aria-busy="true" className="text-sm text-fg-muted">
            Loading pipeline summary…
          </p>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-panel border border-line bg-surface-raised p-4">
        <form className="flex min-w-64 flex-1 flex-wrap items-end gap-3" onSubmit={applySearch}>
          <div className="min-w-52 flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor={searchId}>
              Search deals
            </label>
            <input
              autoComplete="off"
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-fg outline-focus focus-visible:outline-2"
              id={searchId}
              maxLength={100}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Company or deal name"
              type="search"
              value={search}
            />
          </div>
          <button
            className="rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            type="submit"
          >
            Search
          </button>
        </form>
        <div className="min-w-48">
          <label className="mb-1 block text-sm font-medium" htmlFor={stageId}>
            Pipeline stage
          </label>
          <select
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-fg outline-focus focus-visible:outline-2"
            id={stageId}
            onChange={(event) => changeStage(event.currentTarget.value)}
            value={stage}
          >
            <option value="">All stages</option>
            {STAGES.map((item) => (
              <option key={item} value={item}>
                {STAGE_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details
        className="mt-4 rounded-panel border border-line bg-surface-raised p-4"
        ref={createForm}
      >
        <summary className="cursor-pointer font-semibold outline-focus focus-visible:outline-2">
          New deal
        </summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void submitDeal(event)}
        >
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={dealNameId}>
              Deal name
            </label>
            <input
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-fg outline-focus focus-visible:outline-2"
              id={dealNameId}
              maxLength={200}
              name="name"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={sectorId}>
              Sector
            </label>
            <input
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-fg outline-focus focus-visible:outline-2"
              id={sectorId}
              maxLength={100}
              name="sector"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={amountId}>
              Deal size
            </label>
            <input
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-fg outline-focus focus-visible:outline-2"
              id={amountId}
              inputMode="decimal"
              name="amount"
              placeholder="1250000.00"
              type="text"
            />
            <p className="mt-1 text-xs text-fg-muted">
              Enter the amount in major units; decimals are exact.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={currencyId}>
              Currency
            </label>
            <input
              autoCapitalize="characters"
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-fg uppercase outline-focus focus-visible:outline-2"
              defaultValue="ZAR"
              id={currencyId}
              maxLength={3}
              minLength={3}
              name="currency"
              pattern="[A-Z]{3}"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium" htmlFor={closeDateId}>
              Expected close date
            </label>
            <input
              className="rounded-control border border-line bg-surface px-3 py-2 text-fg outline-focus focus-visible:outline-2"
              id={closeDateId}
              name="expectedCloseDate"
              type="date"
            />
          </div>
          {createError && (
            <p
              className="rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg sm:col-span-2"
              role="alert"
            >
              {createError}
            </p>
          )}
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              className="rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
              disabled={creating}
              type="submit"
            >
              {creating ? 'Creating…' : 'Create deal'}
            </button>
            {createMessage && (
              <p aria-live="polite" className="text-sm text-success-fg">
                {createMessage}
              </p>
            )}
          </div>
        </form>
      </details>

      {error && (
        <p
          className="mt-4 rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
          role="alert"
        >
          {error}
        </p>
      )}

      {!error && !loading && result?.items.length === 0 && (
        <div className="mt-4 rounded-panel border border-line bg-surface-raised p-8 text-center">
          <h3 className="font-semibold">No deals found</h3>
          <p className="mt-2 text-sm text-fg-muted">
            {appliedSearch || stage
              ? 'Try changing the search or stage filter.'
              : 'Deals will appear here when your team adds them.'}
          </p>
        </div>
      )}

      {result && result.items.length > 0 && (
        <div
          aria-busy={loading}
          className="mt-4 overflow-x-auto rounded-panel border border-line bg-surface-raised"
        >
          <table className="w-full min-w-[68rem] border-collapse text-left text-sm">
            <caption className="sr-only">Deals in the active organisation</caption>
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium" scope="col">
                  Deal
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Stage
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Sector
                </th>
                <th className="px-4 py-3 text-right font-medium" scope="col">
                  Size
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Expected close
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Stage action
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Deal actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.items.map((deal) => (
                <tr key={deal.id}>
                  <th className="px-4 py-4 font-semibold" scope="row">
                    <Link className="underline focus-visible:outline-2" href={`/deals/${deal.id}`}>
                      {deal.name}
                    </Link>
                  </th>
                  <td className="px-4 py-4">
                    <StageBadge stage={deal.stage} />
                  </td>
                  <td className="px-4 py-4 text-fg-muted">{deal.sector ?? 'Not set'}</td>
                  <td className="px-4 py-4 text-right tabular-nums">
                    {formatMinorAmount(deal.amount, deal.currency)}
                  </td>
                  <td className="px-4 py-4 text-fg-muted">
                    {formatCloseDate(deal.expected_close_date)}
                  </td>
                  <td className="px-4 py-4">
                    {(() => {
                      const destinations = STAGE_TRANSITIONS.filter(
                        ([from]) => from === deal.stage,
                      ).map(([, to]) => to);
                      const selected = moveTargets[deal.id] ?? '';
                      const check = selected
                        ? evaluateMove(deal.stage, selected, [
                            ...(deal.sector ? ['sector'] : []),
                            ...(deal.amount !== null ? ['amount'] : []),
                            ...(deal.expected_close_date ? ['expected_close_date'] : []),
                          ])
                        : null;
                      return destinations.length === 0 ? (
                        <span className="text-fg-muted">Final stage</span>
                      ) : (
                        <div className="flex min-w-52 items-center gap-2">
                          <label className="sr-only" htmlFor={`move-stage-${deal.id}`}>
                            Move {deal.name} to stage
                          </label>
                          <select
                            className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-2 text-sm outline-focus focus-visible:outline-2"
                            disabled={movingDeal === deal.id || loading}
                            id={`move-stage-${deal.id}`}
                            onChange={(event) => {
                              const parsed = stageSchema.safeParse(event.currentTarget.value);
                              const targetStage = parsed.success ? parsed.data : '';
                              setMoveTargets((current) => ({
                                ...current,
                                [deal.id]: targetStage,
                              }));
                            }}
                            value={selected}
                          >
                            <option value="">Move to…</option>
                            {destinations.map((destination) => (
                              <option key={destination} value={destination}>
                                {STAGE_LABELS[destination]}
                              </option>
                            ))}
                          </select>
                          <button
                            className="rounded-control border border-line px-2 py-2 text-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                            disabled={
                              !selected || check?.ok === false || movingDeal === deal.id || loading
                            }
                            onClick={() => void moveStage(deal.id)}
                            type="button"
                          >
                            {movingDeal === deal.id ? 'Moving…' : 'Move'}
                          </button>
                          {check && !check.ok && check.code === 'missing_fields' && (
                            <span className="sr-only">
                              Required fields missing: {check.fields.join(', ')}.
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-4">
                    <details className="min-w-56 rounded-control border border-line p-2">
                      <summary
                        aria-label={`Edit ${deal.name}`}
                        className="cursor-pointer font-medium outline-focus focus-visible:outline-2"
                      >
                        Edit deal
                      </summary>
                      <form
                        className="mt-3 grid gap-3"
                        onSubmit={(event) => void submitUpdate(event, deal)}
                      >
                        <label className="grid gap-1 text-xs font-medium">
                          Name
                          <input
                            className="rounded-control border border-line bg-surface px-2 py-2 text-sm outline-focus focus-visible:outline-2"
                            defaultValue={deal.name}
                            maxLength={200}
                            name="name"
                            required
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Sector
                          <input
                            className="rounded-control border border-line bg-surface px-2 py-2 text-sm outline-focus focus-visible:outline-2"
                            defaultValue={deal.sector ?? ''}
                            maxLength={100}
                            name="sector"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Deal size
                          <input
                            className="rounded-control border border-line bg-surface px-2 py-2 text-sm outline-focus focus-visible:outline-2"
                            defaultValue={majorAmountForInput(deal.amount, deal.currency)}
                            inputMode="decimal"
                            name="amount"
                            type="text"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Currency
                          <input
                            className="rounded-control border border-line bg-surface px-2 py-2 text-sm uppercase outline-focus focus-visible:outline-2"
                            defaultValue={deal.currency}
                            maxLength={3}
                            minLength={3}
                            name="currency"
                            pattern="[A-Z]{3}"
                            required
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Expected close date
                          <input
                            className="rounded-control border border-line bg-surface px-2 py-2 text-sm outline-focus focus-visible:outline-2"
                            defaultValue={deal.expected_close_date ?? ''}
                            name="expectedCloseDate"
                            type="date"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Expected close time
                          <input
                            className="rounded-control border border-line bg-surface px-2 py-2 text-sm outline-focus focus-visible:outline-2"
                            defaultValue={deal.expected_close_time?.slice(0, 5) ?? ''}
                            name="expectedCloseTime"
                            type="time"
                          />
                        </label>
                        <button
                          className="rounded-control bg-brand px-3 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover focus-visible:outline-2 disabled:opacity-50"
                          disabled={updatingDeal === deal.id}
                          type="submit"
                        >
                          {updatingDeal === deal.id ? 'Saving…' : 'Save changes'}
                        </button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moveNotice && (
        <p aria-live="polite" className="mt-3 text-sm text-fg-muted">
          {moveNotice}
        </p>
      )}
      {updateNotice && (
        <p aria-live="polite" className="mt-3 text-sm text-fg-muted">
          {updateNotice}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          {result && result.total > 0
            ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, result.total)} of ${result.total}`
            : ' '}
        </p>
        <div className="flex gap-2">
          <button
            className="rounded-control border border-line px-3 py-2 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
            disabled={offset === 0 || loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              setOffset((current) => Math.max(0, current - PAGE_SIZE));
            }}
            type="button"
          >
            Previous
          </button>
          <button
            className="rounded-control border border-line px-3 py-2 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
            disabled={!result || offset + PAGE_SIZE >= result.total || loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              setOffset((current) => current + PAGE_SIZE);
            }}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
