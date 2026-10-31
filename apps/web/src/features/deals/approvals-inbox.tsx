'use client';

import { STAGE_LABELS, type Deal, type DealApprovalStatus } from '@dpt/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { readDealApprovalStatus, readDeals } from './api';

type ApprovalRow = { readonly deal: Deal; readonly approval: DealApprovalStatus };

function approvalLabel(approval: DealApprovalStatus): string {
  if (!approval.requestId) return 'Approval not requested';
  if (approval.status === 'approved') return 'Approved';
  if (approval.status === 'rejected') return 'Rejected';
  if (approval.canDecide && !approval.currentUserDecision) return 'Your decision needed';
  if (approval.currentUserDecision === 'approve') return 'You approved';
  if (approval.currentUserDecision === 'reject') return 'You rejected';
  return 'Waiting for quorum';
}

export function ApprovalsInbox() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ limit: '100', offset: '0', stage: 'ic_review' });
    void readDeals(query)
      .then(async (result) => {
        const approvals = await Promise.all(
          result.items.map(async (deal) => ({
            deal,
            approval: await readDealApprovalStatus(deal.id),
          })),
        );
        if (active) setRows(approvals);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'IC review items could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <output aria-busy="true">Loading IC approval queue…</output>;
  if (error)
    return (
      <p className="text-sm text-danger-fg" role="alert">
        {error}
      </p>
    );
  if (rows.length === 0) {
    return (
      <section className="material-card p-5">
        <h2 className="font-semibold">No deals awaiting IC review</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Deals appear here when they reach the IC Review stage. Open a deal to see the approval
          status and actions available to your role.
        </p>
        <Link
          className="mt-4 inline-flex text-sm font-semibold text-brand-fg underline"
          href="/pipeline"
        >
          Return to pipeline
        </Link>
      </section>
    );
  }

  return (
    <section aria-label="Deals in IC review" className="grid gap-3">
      {rows.map(({ deal, approval }) => (
        <article
          className="material-card flex flex-wrap items-center justify-between gap-4 p-5"
          key={deal.id}
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              {STAGE_LABELS[deal.stage]}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold">{deal.name}</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {approval.requestId
                ? `${approval.approvedCount} approved · ${approval.pendingCount} pending · ${approval.rejectedCount} rejected`
                : approval.canRequest
                  ? 'No request yet. Open the deal and select “Request IC approval” in its IC approval section.'
                  : 'No request yet. Ask a Deal Lead or authorized requester to open the deal and select “Request IC approval” in its IC approval section.'}
              {approval.requiredApprovals ? ` · ${approval.requiredApprovals} required` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-line px-3 py-1 text-sm font-medium">
              {approvalLabel(approval)}
            </span>
            <Link
              className="inline-flex min-h-8 items-center justify-center rounded-control bg-brand px-3 py-1.5 text-sm font-semibold text-fg-on-brand"
              href={`/deals/${deal.id}`}
            >
              Open review
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
