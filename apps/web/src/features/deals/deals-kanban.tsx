'use client';

import {
  evaluateMove,
  STAGES,
  STAGE_LABELS,
  STAGE_TRANSITIONS,
  type DealListResponse,
  type Stage,
} from '@dpt/shared';
import Link from 'next/link';
import { useState } from 'react';

import { StageBadge } from '../pipeline';
import { formatMinorAmount } from './money';

type Deal = DealListResponse['items'][number];

function missingFieldLabel(field: string): string {
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
}

function closeDateLabel(value: string | null): string {
  if (!value) return 'Close date not set';
  return `Closes ${new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))}`;
}

function dropGuidance(deal: Deal, destination: Stage): string {
  const allowed = STAGE_TRANSITIONS.some(([from, to]) => from === deal.stage && to === destination);
  if (allowed) {
    const check = evaluateMove(deal.stage, destination, [
      ...(deal.sector ? ['sector'] : []),
      ...(deal.amount !== null ? ['amount'] : []),
      ...(deal.expected_close_date ? ['expected_close_date'] : []),
    ]);
    if (!check.ok && check.code === 'missing_fields') {
      return `Add ${check.fields.map(missingFieldLabel).join(' and ')} before moving to ${STAGE_LABELS[destination]}.`;
    }
    return `Drop to move to ${STAGE_LABELS[destination]}.`;
  }
  if (deal.stage === 'ic_review' && destination === 'signed') {
    return 'An approved IC quorum moves this deal to Signed.';
  }
  if (deal.stage === 'ic_review' && destination === 'closed') {
    return 'Approve the IC review first, then move the Signed deal to Closed.';
  }
  return `Move through the required stages before ${STAGE_LABELS[destination]}.`;
}

export function DealsKanban({
  deals,
  disabled,
  onMove,
  onInvalidMove,
}: {
  readonly deals: readonly Deal[];
  readonly disabled: boolean;
  readonly onMove: (dealId: string, stage: Stage) => void;
  readonly onInvalidMove: (message: string) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  function canDrop(dealId: string, destination: Stage): boolean {
    const deal = deals.find((item) => item.id === dealId);
    if (
      !deal ||
      disabled ||
      !STAGE_TRANSITIONS.some(([from, to]) => from === deal.stage && to === destination)
    ) {
      return false;
    }
    return evaluateMove(deal.stage, destination, [
      ...(deal.sector ? ['sector'] : []),
      ...(deal.amount !== null ? ['amount'] : []),
      ...(deal.expected_close_date ? ['expected_close_date'] : []),
    ]).ok;
  }

  const draggedDeal = deals.find((deal) => deal.id === draggedId) ?? null;

  return (
    <>
      {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Keyboard users need focus to scroll this horizontal stage board. */}
      <section
        aria-label="Deals by pipeline stage. Scroll horizontally to see every stage."
        className="mt-4 overflow-x-auto pb-3 focus-visible:rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        tabIndex={0}
      >
        <div className="grid min-w-[70rem] grid-cols-7 gap-3">
          <p className="col-span-6 px-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Pipeline progression
          </p>
          <p className="px-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Outcome
          </p>
          {STAGES.map((stage) => {
            const stageDeals = deals.filter((deal) => deal.stage === stage);
            const accepting = draggedId ? canDrop(draggedId, stage) : false;
            return (
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native drag targets are an enhancement; List view provides keyboard movement.
              <section
                aria-label={`${STAGE_LABELS[stage]} stage, ${stageDeals.length} deals`}
                className={`kanban-stage rounded-card min-h-56 border p-2 transition-colors duration-150 motion-reduce:transition-none ${
                  overStage === stage && accepting
                    ? 'border-brand bg-brand/10'
                    : overStage === stage && draggedDeal
                      ? 'border-danger/50 bg-danger-soft'
                      : 'border-line bg-surface-subtle'
                }`}
                data-stage={stage}
                key={stage}
                onDragEnter={(event) => {
                  if (draggedId) setOverStage(stage);
                  if (draggedId) event.preventDefault();
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setOverStage(null);
                  }
                }}
                onDragOver={(event) => {
                  if (draggedId && overStage !== stage) setOverStage(stage);
                  if (draggedId) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = canDrop(draggedId, stage) ? 'move' : 'none';
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const dealId = event.dataTransfer.getData('text/plain');
                  const deal = deals.find((item) => item.id === dealId);
                  if (canDrop(dealId, stage)) onMove(dealId, stage);
                  else if (deal) onInvalidMove(dropGuidance(deal, stage));
                  setDraggedId(null);
                  setOverStage(null);
                }}
              >
                <header className="flex items-center justify-between gap-2 px-1 py-2">
                  <h3 className="text-sm font-semibold">
                    {stage === 'passed' ? 'Passed · outcome' : STAGE_LABELS[stage]}
                  </h3>
                  <span aria-label={`${stageDeals.length} deals`} className="kanban-stage-count">
                    {stageDeals.length}
                  </span>
                </header>
                {draggedDeal && overStage === stage ? (
                  <p
                    aria-live="polite"
                    className={`mb-2 rounded-control px-2 py-1 text-xs ${
                      accepting ? 'bg-brand-soft text-brand-fg' : 'bg-danger-soft text-danger-fg'
                    }`}
                  >
                    {dropGuidance(draggedDeal, stage)}
                  </p>
                ) : null}
                <ul className="space-y-2">
                  {stageDeals.map((deal) => (
                    <li key={deal.id}>
                      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native draggable card; keyboard users use List view. */}
                      <article
                        className="deal-kanban-card material-card rounded-xl p-3"
                        data-dragging={draggedId === deal.id || undefined}
                        draggable={!disabled}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setOverStage(null);
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', deal.id);
                          setDraggedId(deal.id);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span aria-hidden="true" className="deal-card-monogram">
                            {deal.name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join('')
                              .toUpperCase()}
                          </span>
                          <StageBadge stage={deal.stage} />
                        </div>
                        <Link
                          className="mt-2 block text-sm leading-snug font-semibold decoration-brand/40 underline-offset-4 transition-colors hover:text-brand hover:underline focus-visible:rounded-sm focus-visible:outline-2"
                          href={`/deals/${deal.id}`}
                        >
                          {deal.name}
                        </Link>
                        {deal.stage === 'ic_review' ? (
                          <Link
                            className="mt-2 inline-flex text-xs font-semibold text-brand-fg underline underline-offset-2"
                            href={`/deals/${deal.id}#approval-title`}
                          >
                            Open IC approval
                          </Link>
                        ) : null}
                        <p className="mt-1 truncate text-xs text-fg-muted">
                          {deal.sector ?? 'Sector not set'}
                        </p>
                        <div className="mt-3 flex items-end justify-between gap-2 border-t border-line-subtle pt-2">
                          <p className="min-w-0 truncate text-sm font-semibold tabular-nums">
                            {formatMinorAmount(deal.amount, deal.currency)}
                          </p>
                          <p className="shrink-0 text-right text-[0.68rem] text-fg-muted">
                            {closeDateLabel(deal.expected_close_date)}
                          </p>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
                {stageDeals.length === 0 && (
                  <p className="px-1 py-3 text-xs text-fg-muted">
                    {accepting ? 'Drop deal here' : 'No deals'}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </section>
      {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
    </>
  );
}
