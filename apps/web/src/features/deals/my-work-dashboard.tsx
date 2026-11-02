'use client';

import {
  STAGE_LABELS,
  STAGES,
  type Deal,
  type DealApprovalStatus,
  type MyWorkDeal,
  type Notification,
} from '@dpt/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { readAuthSession } from '../auth';
import { readNotifications, subscribeToDealsChanged } from '../notifications';
import { Button } from '../ui/button';
import { readDealApprovalStatus, readDeals, readMyWork } from './api';

const PAGE_SIZE = 20;
const ACTIVE_STAGES = STAGES.filter((stage) => stage !== 'passed');
type PendingDecision = { readonly deal: Deal; readonly approval: DealApprovalStatus };

function roleLabel(role: MyWorkDeal['assignment_role']): string {
  if (role === 'owner') return 'Deal owner';
  if (role === 'lead') return 'Deal lead';
  return 'Deal team member';
}

function closeDateLabel(date: string | null): string {
  if (!date) return 'No close date set';
  return `Expected close ${new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))}`;
}

function progressStep(stage: MyWorkDeal['stage']): number | null {
  if (stage === 'passed') return null;
  return ACTIVE_STAGES.indexOf(stage) + 1;
}

async function readPendingDecisions(): Promise<PendingDecision[]> {
  const query = new URLSearchParams({ limit: '100', offset: '0', stage: 'ic_review' });
  const result = await readDeals(query);
  const statuses = await Promise.all(
    result.items.map(async (deal) => ({ deal, approval: await readDealApprovalStatus(deal.id) })),
  );
  return statuses.filter(
    ({ approval }) =>
      approval.requestId !== null && approval.canDecide && approval.currentUserDecision === null,
  );
}

function approvalMessage(approval: DealApprovalStatus): string {
  return `${approval.approvedCount} approved · ${approval.pendingCount} pending · ${approval.requiredApprovals ?? 0} required`;
}

function notificationMessage(notification: Notification): string {
  if (notification.kind === 'closing_soon') {
    return `${notification.payload.overdue ? 'Closing date passed' : `Closing in ${notification.payload.thresholdDays} days`} · ${notification.payload.closeDate}`;
  }
  return notification.payload.message;
}

export function MyWorkDashboard() {
  const [deals, setDeals] = useState<MyWorkDeal[]>([]);
  const [totalDeals, setTotalDeals] = useState(0);
  const [activeDeals, setActiveDeals] = useState(0);
  const [decisions, setDecisions] = useState<PendingDecision[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [needsOrganisation, setNeedsOrganisation] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const nextErrors: string[] = [];
      try {
        const session = await readAuthSession();
        if (!active) return;
        if (!session.tenantId) {
          setNeedsOrganisation(true);
          setDeals([]);
          setTotalDeals(0);
          setActiveDeals(0);
          setDecisions([]);
          setNotifications([]);
          setErrors([]);
          setLoading(false);
          return;
        }
        setNeedsOrganisation(false);
        const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        const results = await Promise.allSettled([
          readMyWork(query),
          readPendingDecisions(),
          readNotifications(),
        ]);
        if (!active) return;
        const [workResult, decisionsResult, notificationResult] = results;
        if (workResult.status === 'fulfilled') {
          setDeals(workResult.value.items);
          setTotalDeals(workResult.value.total);
          setActiveDeals(workResult.value.activeCount);
        } else {
          nextErrors.push('Your assigned deals could not be loaded.');
        }
        if (decisionsResult.status === 'fulfilled') {
          setDecisions(decisionsResult.value);
        } else {
          nextErrors.push('Your pending IC decisions could not be loaded.');
        }
        if (notificationResult.status === 'fulfilled') {
          setNotifications(notificationResult.value);
        } else {
          nextErrors.push('Your recent updates could not be loaded.');
        }
      } catch {
        if (active) nextErrors.push('Your account details could not be loaded.');
      }
      if (active) {
        setErrors(nextErrors);
        setLoading(false);
      }
    };
    void load();
    const unsubscribe = subscribeToDealsChanged(() => {
      setLoading(true);
      setErrors([]);
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [offset]);

  const unreadCount = notifications.filter((notification) => notification.read_at === null).length;
  const changePage = (nextOffset: number) => {
    setLoading(true);
    setErrors([]);
    setOffset(nextOffset);
  };

  return (
    <div className="grid gap-6">
      {needsOrganisation ? (
        <output
          aria-labelledby="choose-workspace-organisation"
          className="material-card grid gap-2 p-5"
        >
          <h2 className="font-semibold text-fg" id="choose-workspace-organisation">
            Choose an organisation to load your work
          </h2>
          <p className="text-sm text-fg-muted">
            Select an organisation in the top bar. Your assigned deals, decisions, and updates will
            appear here.
          </p>
        </output>
      ) : null}

      {!needsOrganisation && errors.length > 0 ? (
        <div
          className="grid gap-1 rounded-control border border-danger/30 bg-danger/10 p-4 text-sm text-danger-fg"
          role="alert"
        >
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}

      {!needsOrganisation ? (
        <section aria-label="Personal workload summary" className="grid gap-3 sm:grid-cols-3">
          <article className="material-card p-4 sm:p-5">
            <p className="text-sm text-fg-muted">Active assigned deals</p>
            <p className="mt-2 text-3xl font-semibold text-fg tabular-nums" aria-live="polite">
              {loading ? '—' : activeDeals}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              Of {loading ? '—' : totalDeals} assigned deals
            </p>
          </article>
          <article className="material-card p-4 sm:p-5">
            <p className="text-sm text-fg-muted">IC decisions waiting on you</p>
            <p className="mt-2 text-3xl font-semibold text-fg tabular-nums" aria-live="polite">
              {loading ? '—' : decisions.length}
            </p>
            <Link
              className="mt-1 inline-flex text-xs font-semibold text-brand-fg underline"
              href="/approvals"
            >
              Open approvals
            </Link>
          </article>
          <article className="material-card p-4 sm:p-5">
            <p className="text-sm text-fg-muted">Unread updates</p>
            <p className="mt-2 text-3xl font-semibold text-fg tabular-nums" aria-live="polite">
              {loading ? '—' : unreadCount}
            </p>
            <p className="mt-1 text-xs text-fg-muted">Closing and approval alerts</p>
          </article>
        </section>
      ) : null}

      {!needsOrganisation ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
          <section aria-labelledby="my-assigned-deals" className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-brand-fg uppercase">
                  My deal work
                </p>
                <h2 className="mt-1 text-xl font-semibold text-fg" id="my-assigned-deals">
                  Assigned to you
                </h2>
              </div>
              <span className="text-sm text-fg-muted">
                {loading ? 'Loading…' : `${totalDeals} total`}
              </span>
            </div>
            {loading ? <output aria-busy="true">Loading your assigned deals…</output> : null}
            {!loading && deals.length === 0 ? (
              <div className="material-card p-5">
                <h3 className="font-semibold">No deals assigned to you yet</h3>
                <p className="mt-1 text-sm text-fg-muted">
                  When a deal team assigns you as owner, lead, or member, it will appear here.
                </p>
                <Link
                  className="mt-3 inline-flex text-sm font-semibold text-brand-fg underline"
                  href="/pipeline"
                >
                  Browse the pipeline
                </Link>
              </div>
            ) : null}
            <div className="grid gap-2">
              {deals.map((deal) => {
                const step = progressStep(deal.stage);
                return (
                  <article
                    className="material-card grid gap-2.5 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.9fr)] sm:items-center"
                    key={deal.id}
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[0.6875rem] font-medium text-fg-muted">
                          {roleLabel(deal.assignment_role)}
                        </p>
                        <h3 className="mt-0.5 truncate text-base font-semibold text-fg">
                          <Link
                            className="hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-accent"
                            href={`/deals/${deal.id}`}
                          >
                            {deal.name}
                          </Link>
                        </h3>
                      </div>
                      <span className="rounded-full border border-line px-2 py-0.5 text-xs font-medium">
                        {STAGE_LABELS[deal.stage]}
                      </span>
                    </div>
                    <p className="text-[0.6875rem] text-fg-muted sm:col-span-2">
                      Assigned to{' '}
                      {deal.assigned_to?.length
                        ? deal.assigned_to
                            .map((person) => `${person.displayName ?? 'Unnamed'} (${person.role})`)
                            .join(', ')
                        : 'Unassigned'}
                      {' · '}Created by {deal.created_by?.displayName ?? 'Unknown'} · Updated by{' '}
                      {deal.updated_by?.displayName ?? 'System'}
                      {deal.approved_by?.length
                        ? ` · Approved by ${deal.approved_by.map((person) => person.displayName ?? 'Unknown').join(', ')}`
                        : ''}
                      {deal.rejected
                        ? ` · Rejected${deal.rejection_reason ? `: ${deal.rejection_reason}` : ''}`
                        : ''}
                    </p>
                    {step === null ? (
                      <p className="rounded-control bg-surface-subtle px-2.5 py-1.5 text-xs text-fg-muted sm:text-right">
                        Passed · this deal is no longer progressing.
                      </p>
                    ) : (
                      <div className="grid gap-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[0.6875rem] text-fg-muted">
                          <span>
                            Stage {step} of {ACTIVE_STAGES.length}
                          </span>
                          <span>{closeDateLabel(deal.expected_close_date)}</span>
                        </div>
                        <progress
                          aria-label={`${deal.name} progress`}
                          aria-valuetext={`Stage ${step} of ${ACTIVE_STAGES.length}: ${STAGE_LABELS[deal.stage]}`}
                          className="my-work-progress-track h-1.5"
                          max={ACTIVE_STAGES.length}
                          value={step}
                        />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {!loading && totalDeals > PAGE_SIZE ? (
              <nav aria-label="Assigned deal pages" className="flex items-center justify-between">
                <Button
                  disabled={offset === 0}
                  onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}
                  size="small"
                  variant="secondary"
                >
                  Previous
                </Button>
                <span className="text-sm text-fg-muted">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, totalDeals)} of {totalDeals}
                </span>
                <Button
                  disabled={offset + PAGE_SIZE >= totalDeals}
                  onClick={() => changePage(offset + PAGE_SIZE)}
                  size="small"
                  variant="secondary"
                >
                  Next
                </Button>
              </nav>
            ) : null}
          </section>

          <div className="grid gap-5">
            <section aria-labelledby="pending-my-decisions" className="grid gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-brand-fg uppercase">
                  Decision queue
                </p>
                <h2 className="mt-1 text-xl font-semibold text-fg" id="pending-my-decisions">
                  Waiting on your review
                </h2>
              </div>
              {loading ? <output aria-busy="true">Checking your approval decisions…</output> : null}
              {!loading && decisions.length === 0 ? (
                <div className="material-card p-4">
                  <p className="text-sm text-fg-muted">No IC decisions are waiting on you.</p>
                  <Link
                    className="mt-2 inline-flex text-sm font-semibold text-brand-fg underline"
                    href="/approvals"
                  >
                    See all IC reviews
                  </Link>
                </div>
              ) : null}
              {decisions.map(({ deal, approval }) => (
                <article className="material-card p-4" key={deal.id}>
                  <p className="text-xs font-medium text-fg-muted">IC Review</p>
                  <h3 className="mt-1 font-semibold text-fg">{deal.name}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{approvalMessage(approval)}</p>
                  <Link
                    className="mt-3 inline-flex text-sm font-semibold text-brand-fg underline"
                    href={`/deals/${deal.id}`}
                  >
                    Review decision
                  </Link>
                </article>
              ))}
            </section>

            <section aria-labelledby="recent-personal-updates" className="grid gap-3">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-brand-fg uppercase">
                  Recent activity
                </p>
                <h2 className="mt-1 text-xl font-semibold text-fg" id="recent-personal-updates">
                  Your updates
                </h2>
              </div>
              {loading ? <output aria-busy="true">Loading your updates…</output> : null}
              {!loading && notifications.length === 0 ? (
                <div className="material-card p-4">
                  <p className="text-sm text-fg-muted">No recent updates.</p>
                </div>
              ) : null}
              {notifications.slice(0, 4).map((notification) => (
                <article className="material-card p-4" key={notification.id}>
                  <p className="text-xs font-medium text-fg-muted">
                    {notification.read_at === null ? 'Unread update' : 'Update'}
                  </p>
                  <h3 className="mt-1 font-semibold text-fg">{notification.payload.dealName}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{notificationMessage(notification)}</p>
                  <Link
                    className="mt-2 inline-flex text-sm font-semibold text-brand-fg underline"
                    href={notification.payload.href}
                  >
                    Open update
                  </Link>
                </article>
              ))}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
