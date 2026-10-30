'use client';

import type {
  ApprovalAbsence,
  ApprovalReassignmentOptions,
  Deal,
  DealActivityResponse,
  DealApprovalStatus,
} from '@dpt/shared';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';

import { StageBadge } from '../pipeline';
import { PageHeading } from '../shell/page-heading';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SelectControl } from '../ui/select-control';
import { Textarea } from '../ui/textarea';
import { formatActivityBody, formatActivityKind } from './activity-format';
import {
  configureDealApprovalPolicy,
  cancelApprovalAbsence,
  decideDealApproval,
  readApprovalAbsences,
  readApprovalReassignmentOptions,
  readDealApprovalPolicy,
  postDealNote,
  readDeal,
  readDealActivity,
  readDealApprovalStatus,
  requestDealApproval,
  reassignApprovalApprover,
  setApprovalAbsence,
} from './api';
import { ApprovalDelegations } from './approval-delegations';
import { DealFiles } from './deal-files';
import { formatMinorAmount } from './money';

async function loadDealData(dealId: string) {
  const [deal, activity, approval] = await Promise.all([
    readDeal(dealId),
    readDealActivity(dealId),
    readDealApprovalStatus(dealId),
  ]);
  const [absences, reassignmentOptions, policy] = await Promise.all([
    approval.canManageAbsence ? readApprovalAbsences() : Promise.resolve([]),
    approval.canReassign && approval.requestId
      ? readApprovalReassignmentOptions(approval.requestId)
      : Promise.resolve(null),
    approval.canConfigure
      ? readDealApprovalPolicy()
      : Promise.resolve({ requiredApprovals: null, delegationEnabled: false }),
  ]);
  return [deal, activity, approval, absences, reassignmentOptions, policy] as const;
}

interface DealDetailProps {
  readonly dealId: string;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatExpectedClose(date: string, time: string | null): string {
  const formattedDate = new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
  const formattedTime = time?.slice(0, 5);
  return formattedTime ? `${formattedDate} at ${formattedTime}` : formattedDate;
}

export function DealDetail({ dealId }: DealDetailProps) {
  const noteId = useId();
  const quorumId = useId();
  const rejectionReasonId = useId();
  const absenceStartId = useId();
  const absenceEndId = useId();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [activity, setActivity] = useState<DealActivityResponse | null>(null);
  const [approval, setApproval] = useState<DealApprovalStatus | null>(null);
  const [absences, setAbsences] = useState<ApprovalAbsence[]>([]);
  const [reassignmentOptions, setReassignmentOptions] =
    useState<ApprovalReassignmentOptions | null>(null);
  const [absenceStart, setAbsenceStart] = useState('');
  const [absenceEnd, setAbsenceEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [quorum, setQuorum] = useState('1');
  const [delegationEnabled, setDelegationEnabled] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [posting, setPosting] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDealData(dealId)
      .then(([detail, events, approvalStatus, ownAbsences, options, policy]) => {
        if (!active) return;
        setDeal(detail);
        setActivity(events);
        setApproval(approvalStatus);
        setAbsences(ownAbsences);
        setReassignmentOptions(options);
        setQuorum(String(approvalStatus.configuredApprovals ?? 1));
        setDelegationEnabled(policy.delegationEnabled);
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
    setApproval(null);
    try {
      const [detail, events, approvalStatus, ownAbsences, options, policy] =
        await loadDealData(dealId);
      setDeal(detail);
      setActivity(events);
      setApproval(approvalStatus);
      setAbsences(ownAbsences);
      setReassignmentOptions(options);
      setQuorum(String(approvalStatus.configuredApprovals ?? 1));
      setDelegationEnabled(policy.delegationEnabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deal details could not be loaded.');
    }
  }

  async function refreshApprovalData() {
    const [detail, events, approvalStatus, ownAbsences, options, policy] =
      await loadDealData(dealId);
    setDeal(detail);
    setActivity(events);
    setApproval(approvalStatus);
    setAbsences(ownAbsences);
    setReassignmentOptions(options);
    setQuorum(String(approvalStatus.configuredApprovals ?? 1));
    setDelegationEnabled(policy.delegationEnabled);
  }

  async function submitApprovalRequest() {
    if (!deal) return;
    setApprovalError(null);
    setApprovalBusy(true);
    try {
      await requestDealApproval(deal.id, deal.version);
      await refreshApprovalData();
    } catch (cause) {
      setApprovalError(
        cause instanceof Error ? cause.message : 'The approval request could not be submitted.',
      );
    } finally {
      setApprovalBusy(false);
    }
  }

  async function decideApproval(decision: 'approve' | 'reject') {
    if (!approval?.requestId) return;
    setApprovalError(null);
    setApprovalBusy(true);
    try {
      await decideDealApproval(
        approval.requestId,
        decision,
        decision === 'reject' && rejectionReason.trim() ? rejectionReason.trim() : undefined,
      );
      setRejectionReason('');
      await refreshApprovalData();
    } catch (cause) {
      setApprovalError(
        cause instanceof Error ? cause.message : 'The approval decision could not be saved.',
      );
    } finally {
      setApprovalBusy(false);
    }
  }

  async function saveApprovalPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApprovalError(null);
    setApprovalBusy(true);
    try {
      await configureDealApprovalPolicy(Number(quorum), delegationEnabled);
      await refreshApprovalData();
    } catch (cause) {
      setApprovalError(
        cause instanceof Error ? cause.message : 'The approval policy could not be saved.',
      );
    } finally {
      setApprovalBusy(false);
    }
  }

  async function scheduleAbsence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApprovalError(null);
    setApprovalBusy(true);
    try {
      await setApprovalAbsence(
        new Date(absenceStart).toISOString(),
        new Date(absenceEnd).toISOString(),
      );
      setAbsenceStart('');
      setAbsenceEnd('');
      await refreshApprovalData();
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : 'The absence could not be saved.');
    } finally {
      setApprovalBusy(false);
    }
  }

  async function cancelAbsence(absenceId: string) {
    setApprovalError(null);
    setApprovalBusy(true);
    try {
      await cancelApprovalAbsence(absenceId);
      await refreshApprovalData();
    } catch (cause) {
      setApprovalError(
        cause instanceof Error ? cause.message : 'The absence could not be cancelled.',
      );
    } finally {
      setApprovalBusy(false);
    }
  }

  async function reassignApprover(fromMembershipId: string, toMembershipId: string) {
    if (!approval?.requestId) return;
    setApprovalError(null);
    setApprovalBusy(true);
    try {
      await reassignApprovalApprover(approval.requestId, fromMembershipId, toMembershipId);
      await refreshApprovalData();
    } catch (cause) {
      setApprovalError(
        cause instanceof Error ? cause.message : 'The approver could not be reassigned.',
      );
    } finally {
      setApprovalBusy(false);
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
        <h1 className="text-3xl font-semibold tracking-tight" id="deal-detail-title">
          Deal details
        </h1>
        <p className="mt-4" role="alert">
          {error}
        </p>
        <Button className="mt-4" onClick={() => void reload()} type="button" variant="secondary">
          Try again
        </Button>
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
    <div className="space-y-8">
      <PageHeading
        eyebrow={
          <Link className="text-sm text-fg-muted underline focus-visible:outline-2" href="/">
            Back to deals
          </Link>
        }
        spacing="compact"
        title={deal.name}
        action={<StageBadge stage={deal.stage} />}
      />

      <section aria-labelledby="overview-title" className="material-card p-5">
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
              {deal.expected_close_date
                ? formatExpectedClose(deal.expected_close_date, deal.expected_close_time)
                : 'Not set'}
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

      {approval &&
      (deal.stage === 'ic_review' || approval.requestId !== null || approval.canManageAbsence) ? (
        <section aria-labelledby="approval-title" className="material-card p-5">
          <h2 className="text-xl font-semibold" id="approval-title">
            IC approval
          </h2>
          {approval.requiredApprovals === null && approval.configuredApprovals === null ? (
            <p className="mt-2 text-fg-muted">
              No approval quorum is configured for this organisation.
            </p>
          ) : (
            <p className="mt-2 text-fg-muted">
              Required approvals: {approval.requiredApprovals ?? approval.configuredApprovals}
              {approval.status === 'pending'
                ? ` · ${approval.approvedCount} approved · ${approval.pendingCount} pending · ${approval.rejectedCount} rejected`
                : ''}
            </p>
          )}
          {approval.status === 'approved' ? <p className="mt-2">Approval quorum reached.</p> : null}
          {approval.status === 'rejected' ? (
            <p className="mt-2">Approval request failed because quorum was no longer reachable.</p>
          ) : null}
          {approval.canConfigure ? (
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={(event) => void saveApprovalPolicy(event)}
            >
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor={quorumId}>
                  Required approvals
                </label>
                <Input
                  className="w-28"
                  id={quorumId}
                  max={50}
                  min={1}
                  onChange={(event) => setQuorum(event.currentTarget.value)}
                  required
                  type="number"
                  value={quorum}
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  checked={delegationEnabled}
                  disabled={approvalBusy}
                  onChange={(event) => setDelegationEnabled(event.currentTarget.checked)}
                  type="checkbox"
                />
                Allow temporary approval delegation
              </label>
              <Button disabled={approvalBusy} type="submit" variant="primary">
                Save approval policy
              </Button>
            </form>
          ) : null}
          {approval.canRequest ? (
            <Button
              className="mt-4"
              disabled={approvalBusy}
              onClick={() => void submitApprovalRequest()}
              type="button"
              variant="primary"
            >
              {approvalBusy ? 'Submitting…' : 'Submit for approval'}
            </Button>
          ) : null}
          {approval.canDecide ? (
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium" htmlFor={rejectionReasonId}>
                Rejection reason (optional)
              </label>
              <Textarea
                className="w-full"
                id={rejectionReasonId}
                maxLength={2000}
                onChange={(event) => setRejectionReason(event.currentTarget.value)}
                value={rejectionReason}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={approvalBusy}
                  onClick={() => void decideApproval('approve')}
                  type="button"
                  variant="primary"
                >
                  Approve
                </Button>
                <Button
                  disabled={approvalBusy}
                  onClick={() => void decideApproval('reject')}
                  type="button"
                  variant="danger"
                >
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
          {approval.canManageAbsence ? (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="font-semibold">Your approval availability</h3>
              <p className="mt-1 text-sm text-fg-muted">
                While an absence is active, you are removed from pending approval quorum
                calculations.
              </p>
              {absences.length ? (
                <ul className="mt-3 space-y-2">
                  {absences.map((absence) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-3 text-sm"
                      key={absence.id}
                    >
                      <span>
                        {formatDate(absence.startsAt)} – {formatDate(absence.endsAt)}
                        {absence.active ? ' · Active' : ' · Upcoming'}
                      </span>
                      <Button
                        disabled={approvalBusy}
                        onClick={() => void cancelAbsence(absence.id)}
                        size="small"
                        type="button"
                        variant="secondary"
                      >
                        Cancel absence
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <form
                className="mt-3 flex flex-wrap items-end gap-3"
                onSubmit={(event) => void scheduleAbsence(event)}
              >
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={absenceStartId}>
                    Starts
                  </label>
                  <Input
                    id={absenceStartId}
                    onChange={(event) => setAbsenceStart(event.currentTarget.value)}
                    required
                    type="datetime-local"
                    value={absenceStart}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={absenceEndId}>
                    Ends
                  </label>
                  <Input
                    id={absenceEndId}
                    min={absenceStart || undefined}
                    onChange={(event) => setAbsenceEnd(event.currentTarget.value)}
                    required
                    type="datetime-local"
                    value={absenceEnd}
                  />
                </div>
                <Button disabled={approvalBusy} type="submit" variant="secondary">
                  Schedule absence
                </Button>
              </form>
            </div>
          ) : null}
          {approval.canManageAbsence ? <ApprovalDelegations /> : null}
          {approval.canReassign && reassignmentOptions ? (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="font-semibold">Unavailable approvers</h3>
              {reassignmentOptions.unavailableApprovers.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">
                  No pending approvers need reassignment.
                </p>
              ) : reassignmentOptions.eligibleReplacements.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">
                  No eligible replacement is available. The request remains pending until the quorum
                  can be met.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {reassignmentOptions.unavailableApprovers.map((approver) => {
                    const replacementSelectId = `replacement-${approver.membershipId}`;
                    return (
                      <li
                        className="rounded-control border border-line p-3"
                        key={approver.membershipId}
                      >
                        <p className="text-sm">
                          {approver.displayName ?? 'Unnamed member'} is unavailable for this
                          request.
                        </p>
                        <form
                          className="mt-2 flex flex-wrap items-end gap-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const replacementId = new FormData(event.currentTarget).get(
                              'replacement',
                            );
                            if (typeof replacementId === 'string') {
                              void reassignApprover(approver.membershipId, replacementId);
                            }
                          }}
                        >
                          <div>
                            <label
                              className="mb-1 block text-sm font-medium"
                              htmlFor={replacementSelectId}
                            >
                              Replacement approver
                            </label>
                            <SelectControl
                              className="min-w-56"
                              defaultValue={
                                reassignmentOptions.eligibleReplacements[0]?.membershipId
                              }
                              id={replacementSelectId}
                              name="replacement"
                            >
                              {reassignmentOptions.eligibleReplacements.map((replacement) => (
                                <option
                                  key={replacement.membershipId}
                                  value={replacement.membershipId}
                                >
                                  {replacement.displayName ?? 'Unnamed member'}
                                </option>
                              ))}
                            </SelectControl>
                          </div>
                          <Button disabled={approvalBusy} type="submit" variant="secondary">
                            Reassign approver
                          </Button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
          {approvalError ? (
            <p className="mt-3 text-danger" role="alert">
              {approvalError}
            </p>
          ) : null}
        </section>
      ) : null}

      <DealFiles dealId={dealId} />

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
        <form className="material-card mt-4 p-4" onSubmit={(event) => void submitNote(event)}>
          <label className="mb-2 block text-sm font-medium" htmlFor={noteId}>
            Add a note
          </label>
          <Textarea className="w-full" id={noteId} maxLength={10000} name="body" required />
          {noteError ? (
            <p className="mt-2 text-danger" role="alert">
              {noteError}
            </p>
          ) : null}
          <Button className="mt-3" disabled={posting} type="submit" variant="primary">
            {posting ? 'Saving…' : 'Add note'}
          </Button>
          <p className="mt-2 text-sm text-fg-muted">
            Notes are permanent audit records and cannot be edited or deleted.
          </p>
        </form>
        {activity.events.length === 0 ? (
          <p className="mt-4 text-fg-muted">No activity yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {activity.events.map((item) => (
              <li className="material-card p-4" key={item.id}>
                <p className="font-medium">{formatActivityKind(item.kind)}</p>
                <p className="mt-2 whitespace-pre-wrap">
                  {formatActivityBody(item.kind, item.body)}
                </p>
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
          <Button
            className="mt-4"
            disabled={loadingOlder}
            onClick={() => void loadOlderActivity()}
            variant="secondary"
            type="button"
          >
            {loadingOlder ? 'Loading…' : 'Load older activity'}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
