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
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SelectControl } from '../ui/select-control';
import { createDeal, moveDealStage, readDashboardSummary, readDeals, updateDeal } from './api';
import { DealsKanban } from './deals-kanban';
import { formatMinorAmount, majorAmountForInput, parseMajorAmount } from './money';

const PAGE_SIZE = 25;

type ActionToast = { readonly kind: 'success' | 'error' | 'info'; readonly message: string };

function actionErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.name === 'ZodError') {
    try {
      const issues: unknown = JSON.parse(cause.message);
      if (Array.isArray(issues)) {
        const firstMessage = issues.find(
          (issue): issue is { message: string } =>
            typeof issue === 'object' &&
            issue !== null &&
            'message' in issue &&
            typeof issue.message === 'string',
        )?.message;
        if (firstMessage) return firstMessage;
      }
    } catch {
      return fallback;
    }
    return fallback;
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

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
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const editId = useId();
  const createForm = useRef<HTMLDetailsElement>(null);
  const [stage, setStage] = useState<Stage | ''>('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [result, setResult] = useState<DealListResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openMoveMenu, setOpenMoveMenu] = useState<string | null>(null);
  const [movingDeal, setMovingDeal] = useState<string | null>(null);
  const [updatingDeal, setUpdatingDeal] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<ActionToast | null>(null);
  const [editingDeal, setEditingDeal] = useState<DealListResponse['items'][number] | null>(null);

  useEffect(() => {
    if (!actionToast) return undefined;
    const timer = window.setTimeout(() => setActionToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

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

  useEffect(() => {
    const dialog = editDialogRef.current;
    if (!dialog) return;
    if (editingDeal && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!editingDeal && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [editingDeal]);

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
      setCreateError(actionErrorMessage(cause, 'The deal could not be created.'));
    } finally {
      setCreating(false);
    }
  }

  async function moveStage(dealId: string, toStage: Stage) {
    const deal = result?.items.find((item) => item.id === dealId);
    if (!deal) return;
    setActionToast(null);
    setOpenMoveMenu(null);
    setMovingDeal(dealId);
    try {
      await moveDealStage(deal.id, toStage, deal.version);
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (stage) query.set('stage', stage);
      if (appliedSearch) query.set('search', appliedSearch);
      const refreshed = await readDeals(query);
      setResult(refreshed);
      void refreshSummary();
      setActionToast({
        kind: 'success',
        message: `${deal.name} moved to ${STAGE_LABELS[toStage]}.`,
      });
    } catch (cause) {
      setActionToast({
        kind: 'error',
        message: actionErrorMessage(
          cause,
          `Could not move ${deal.name}. Check the stage requirements and try again.`,
        ),
      });
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
    setActionToast(null);
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
      if (Object.keys(changes).length === 0) {
        setEditingDeal(null);
        setActionToast({ kind: 'info', message: 'No changes to save.' });
        return;
      }
      const body = updateDealBodySchema.parse({ expectedVersion: deal.version, ...changes });
      await updateDeal(deal.id, body);
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (stage) query.set('stage', stage);
      if (appliedSearch) query.set('search', appliedSearch);
      setResult(await readDeals(query));
      void refreshSummary();
      setActionToast({ kind: 'success', message: `${deal.name} updated.` });
      setEditingDeal(null);
    } catch (cause) {
      setActionToast({
        kind: 'error',
        message: actionErrorMessage(
          cause,
          `Could not save ${deal.name}. Check the details and try again.`,
        ),
      });
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
        <div className="flex flex-wrap items-center gap-3">
          <p
            aria-live="polite"
            className="rounded-control bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand-fg"
          >
            {loading
              ? 'Loading deals…'
              : `${result?.total ?? 0} ${result?.total === 1 ? 'deal' : 'deals'}`}
          </p>
          <Button
            onClick={() => {
              if (!createForm.current) return;
              createForm.current.open = true;
              createForm.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
              createForm.current.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
            }}
            type="button"
            variant="primary"
          >
            Add deal
          </Button>
        </div>
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
            <Button
              className="mt-2"
              onClick={() => void refreshSummary()}
              type="button"
              variant="quiet"
            >
              Retry summary
            </Button>
          </div>
        ) : summary ? (
          <div aria-busy={false} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <article className="pipeline-stat pipeline-stat-value material-card p-4">
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
              <article className="pipeline-stat pipeline-stat-closing material-card p-4">
                <h4 className="text-sm text-fg-muted">Closing soon</h4>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {summary.closingSoonCount}
                </p>
                <p className="text-sm text-fg-muted">
                  Within {summary.windowDays} days, including overdue deals
                </p>
              </article>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="stage-overview-title" className="material-card p-4">
                <h4 className="font-semibold" id="stage-overview-title">
                  Deals by stage
                </h4>
                <ul className="mt-3 space-y-1">
                  {summary.pipelineByStage.map((item) => (
                    <li key={item.stage}>
                      <button
                        aria-label={`Filter deals to ${STAGE_LABELS[item.stage]} (${item.count})`}
                        aria-pressed={stage === item.stage}
                        className="stage-overview-link"
                        onClick={() => changeStage(item.stage)}
                        type="button"
                      >
                        <span>{STAGE_LABELS[item.stage]}</span>
                        <span className="stage-overview-count">{item.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="closing-soon-title" className="material-card p-4">
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

      <div className="material-card mt-6 flex flex-wrap items-end justify-between gap-4 p-4">
        <form className="flex min-w-64 flex-1 flex-wrap items-end gap-3" onSubmit={applySearch}>
          <div className="min-w-52 flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor={searchId}>
              Search deals
            </label>
            <Input
              autoComplete="off"
              className="w-full"
              id={searchId}
              maxLength={100}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Company or deal name"
              type="search"
              value={search}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <div className="min-w-48">
          <label className="mb-1 block text-sm font-medium" htmlFor={stageId}>
            Pipeline stage
          </label>
          <SelectControl
            className="w-full"
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
          </SelectControl>
        </div>
      </div>

      <details className="material-card mt-4 p-4" id="new-deal-form" ref={createForm}>
        <summary className="deal-create-trigger">New deal</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void submitDeal(event)}
        >
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={dealNameId}>
              Deal name
            </label>
            <Input className="w-full" id={dealNameId} maxLength={200} name="name" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={sectorId}>
              Sector
            </label>
            <Input className="w-full" id={sectorId} maxLength={100} name="sector" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={amountId}>
              Deal size
            </label>
            <Input
              className="w-full"
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
            <Input
              autoCapitalize="characters"
              className="w-full uppercase"
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
            <Input id={closeDateId} name="expectedCloseDate" type="date" />
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
            <Button disabled={creating} type="submit" variant="primary">
              {creating ? 'Creating…' : 'Create deal'}
            </Button>
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
        <div className="material-card mt-4 p-8 text-center">
          <h3 className="font-semibold">No deals found</h3>
          <p className="mt-2 text-sm text-fg-muted">
            {appliedSearch || stage
              ? 'Try changing the search or stage filter.'
              : 'Deals will appear here when your team adds them.'}
          </p>
        </div>
      )}

      {result && result.items.length > 0 && (
        <>
          <aside aria-label="Stage movement rules" className="material-card mt-4 p-4 text-sm">
            <h3 className="font-semibold">How deal stages work</h3>
            <ul className="mt-2 grid gap-2 text-fg-muted md:grid-cols-3">
              <li>
                <strong className="text-fg">IC Review → Signed:</strong> open an IC Review deal and
                request approval from its IC approval section. The quorum moves approved deals to
                Signed automatically.
              </li>
              <li>
                <strong className="text-fg">Signed → Closed:</strong> after signing, move it to
                Closed. Deal size, sector, and expected close date are required.
              </li>
              <li>
                <strong className="text-fg">Passed:</strong> use this outcome when a deal exits the
                pipeline. It is separate from progression to Signed and Closed.
              </li>
            </ul>
          </aside>
          <fieldset className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <legend className="sr-only">Deals view</legend>
            <div className="inline-flex items-center gap-1 rounded-lg border border-line-subtle bg-surface-subtle p-1">
              <Button
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                size="small"
                type="button"
                variant={view === 'list' ? 'primary' : 'quiet'}
              >
                List
              </Button>
              <Button
                aria-pressed={view === 'board'}
                onClick={() => setView('board')}
                size="small"
                type="button"
                variant={view === 'board' ? 'primary' : 'quiet'}
              >
                Board
              </Button>
            </div>
            {view === 'board' && (
              <span className="text-xs text-fg-muted">
                Drag cards between allowed stages. Use List for keyboard stage controls.
              </span>
            )}
          </fieldset>
        </>
      )}

      {view === 'board' && result && result.items.length > 0 && (
        <DealsKanban
          deals={result.items}
          disabled={loading || movingDeal !== null}
          onMove={(dealId, destination) => void moveStage(dealId, destination)}
          onInvalidMove={(message) => setActionToast({ kind: 'info', message })}
        />
      )}

      {view === 'list' && result && result.items.length > 0 && (
        <>
          <p className="mt-3 text-xs text-fg-muted sm:hidden">
            Swipe the table sideways to see every field and deal action.
          </p>
          <div aria-busy={loading} className="material-card mt-4 min-w-0 overflow-x-auto">
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
                    Move
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
                      <Link
                        className="underline focus-visible:outline-2"
                        href={`/deals/${deal.id}`}
                      >
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
                        return destinations.length === 0 ? (
                          <span className="text-fg-muted">Final stage</span>
                        ) : (
                          <div className="min-w-36">
                            {deal.stage === 'ic_review' ? (
                              <Link
                                className="mb-2 inline-block text-sm font-medium text-brand-fg underline underline-offset-4 focus-visible:outline-2"
                                href={`/deals/${deal.id}#approval-title`}
                              >
                                Open IC approval
                              </Link>
                            ) : null}
                            <Button
                              aria-expanded={openMoveMenu === deal.id}
                              className="w-full justify-between"
                              disabled={movingDeal === deal.id || loading}
                              onClick={() =>
                                setOpenMoveMenu((current) => (current === deal.id ? null : deal.id))
                              }
                              size="small"
                              type="button"
                              variant="secondary"
                            >
                              <span>{movingDeal === deal.id ? 'Moving…' : 'Move to…'}</span>
                              <span aria-hidden="true">{openMoveMenu === deal.id ? '▴' : '▾'}</span>
                            </Button>
                            {openMoveMenu === deal.id ? (
                              <fieldset className="mt-2 space-y-1 rounded-control border border-line bg-surface-raised p-2">
                                <legend className="sr-only">Available moves for {deal.name}</legend>
                                <p className="px-2 pb-1 text-xs text-fg-muted">
                                  Move from {STAGE_LABELS[deal.stage]}
                                </p>
                                {destinations.map((destination) => {
                                  const check = evaluateMove(deal.stage, destination, [
                                    ...(deal.sector ? ['sector'] : []),
                                    ...(deal.amount !== null ? ['amount'] : []),
                                    ...(deal.expected_close_date ? ['expected_close_date'] : []),
                                  ]);
                                  const missingFields =
                                    !check.ok && check.code === 'missing_fields'
                                      ? check.fields.map((field) => {
                                          switch (field) {
                                            case 'amount':
                                              return 'deal size';
                                            case 'sector':
                                              return 'sector';
                                            case 'expected_close_date':
                                              return 'expected close date';
                                            default:
                                              return field;
                                          }
                                        })
                                      : [];
                                  return (
                                    <div key={destination}>
                                      <Button
                                        className="w-full justify-start"
                                        disabled={missingFields.length > 0 || loading}
                                        onClick={() => void moveStage(deal.id, destination)}
                                        size="small"
                                        type="button"
                                        variant="quiet"
                                      >
                                        Move to {STAGE_LABELS[destination]}
                                      </Button>
                                      {missingFields.length > 0 ? (
                                        <p className="px-2 pb-1 text-xs text-fg-muted">
                                          Requires {missingFields.join(' and ')}
                                        </p>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </fieldset>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-4">
                      <Button
                        aria-haspopup="dialog"
                        aria-label={`Edit ${deal.name}`}
                        onClick={() => {
                          setActionToast(null);
                          setEditingDeal(deal);
                        }}
                        size="small"
                        type="button"
                        variant="secondary"
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <dialog
        aria-describedby={`${editId}-description`}
        aria-labelledby={`${editId}-title`}
        className="deal-edit-dialog"
        onClose={() => setEditingDeal(null)}
        ref={editDialogRef}
      >
        {editingDeal ? (
          <form
            className="deal-edit-form"
            onSubmit={(event) => void submitUpdate(event, editingDeal)}
          >
            <header className="deal-edit-header">
              <p className="page-heading-eyebrow">Deal details</p>
              <h2 className="mt-1 text-xl font-semibold" id={`${editId}-title`}>
                Edit {editingDeal.name}
              </h2>
              <p className="mt-1 text-sm text-fg-muted" id={`${editId}-description`}>
                Update the core details used across your pipeline and reports.
              </p>
            </header>
            {editingDeal.stage === 'ic_review' ? (
              <aside className="rounded-control border border-line bg-surface-raised p-3">
                <p className="text-sm text-fg-muted">
                  Need to request an IC decision? Approval requests are managed in the deal’s IC
                  approval section.
                </p>
                <Link
                  className="mt-2 inline-block text-sm font-medium text-brand-fg underline underline-offset-4 focus-visible:outline-2"
                  href={`/deals/${editingDeal.id}#approval-title`}
                >
                  Open IC approval
                </Link>
              </aside>
            ) : null}
            <div className="deal-edit-fields">
              <label htmlFor={`${editId}-name`}>
                <span>Deal name</span>
                <Input
                  autoFocus
                  defaultValue={editingDeal.name}
                  id={`${editId}-name`}
                  maxLength={200}
                  name="name"
                  required
                />
              </label>
              <label htmlFor={`${editId}-sector`}>
                <span>
                  Sector <span className="text-fg-muted">(optional)</span>
                </span>
                <Input
                  defaultValue={editingDeal.sector ?? ''}
                  id={`${editId}-sector`}
                  maxLength={100}
                  name="sector"
                />
              </label>
              <label htmlFor={`${editId}-amount`}>
                <span>
                  Deal size <span className="text-fg-muted">({editingDeal.currency})</span>
                </span>
                <Input
                  defaultValue={majorAmountForInput(editingDeal.amount, editingDeal.currency)}
                  id={`${editId}-amount`}
                  inputMode="decimal"
                  name="amount"
                  type="text"
                />
                <span className="text-xs font-normal text-fg-muted">
                  Enter the amount in major units; decimals are exact.
                </span>
              </label>
              <label htmlFor={`${editId}-currency`}>
                <span>Currency</span>
                <Input
                  className="uppercase"
                  defaultValue={editingDeal.currency}
                  id={`${editId}-currency`}
                  maxLength={3}
                  minLength={3}
                  name="currency"
                  pattern="[A-Z]{3}"
                  required
                />
              </label>
              <label htmlFor={`${editId}-close-date`}>
                <span>
                  Expected close date <span className="text-fg-muted">(optional)</span>
                </span>
                <Input
                  defaultValue={editingDeal.expected_close_date ?? ''}
                  id={`${editId}-close-date`}
                  name="expectedCloseDate"
                  type="date"
                />
              </label>
              <label htmlFor={`${editId}-close-time`}>
                <span>
                  Expected close time <span className="text-fg-muted">(optional)</span>
                </span>
                <Input
                  defaultValue={editingDeal.expected_close_time?.slice(0, 5) ?? ''}
                  id={`${editId}-close-time`}
                  name="expectedCloseTime"
                  type="time"
                />
              </label>
            </div>
            <footer className="deal-edit-footer">
              <Button
                disabled={updatingDeal === editingDeal.id}
                onClick={() => setEditingDeal(null)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button disabled={updatingDeal === editingDeal.id} type="submit" variant="primary">
                {updatingDeal === editingDeal.id ? 'Saving…' : 'Save changes'}
              </Button>
            </footer>
          </form>
        ) : null}
      </dialog>

      {actionToast ? (
        <aside
          aria-atomic="true"
          aria-live={actionToast.kind === 'error' ? 'assertive' : 'polite'}
          className={`deal-action-toast deal-action-toast-${actionToast.kind}`}
          role={actionToast.kind === 'error' ? 'alert' : 'status'}
        >
          <p>{actionToast.message}</p>
          <Button
            aria-label="Dismiss message"
            onClick={() => setActionToast(null)}
            size="small"
            type="button"
            variant="quiet"
          >
            Dismiss
          </Button>
        </aside>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-fg-muted">
          {result && result.total > 0
            ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, result.total)} of ${result.total}`
            : ' '}
        </p>
        <div className="flex gap-2">
          <Button
            className="text-sm"
            disabled={offset === 0 || loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              setOffset((current) => Math.max(0, current - PAGE_SIZE));
            }}
            size="small"
            type="button"
            variant="secondary"
          >
            Previous
          </Button>
          <Button
            className="text-sm"
            disabled={!result || offset + PAGE_SIZE >= result.total || loading}
            onClick={() => {
              setLoading(true);
              setError(null);
              setOffset((current) => current + PAGE_SIZE);
            }}
            size="small"
            type="button"
            variant="secondary"
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
