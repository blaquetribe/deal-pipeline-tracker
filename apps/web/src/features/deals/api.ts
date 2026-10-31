import {
  dealListResponseSchema,
  dealDetailResponseSchema,
  dealActivityResponseSchema,
  approvalAbsenceBodySchema,
  approvalAbsencesResponseSchema,
  approvalDelegateOptionsSchema,
  approvalDelegationBodySchema,
  approvalDelegationsResponseSchema,
  createNoteBodySchema,
  approvalDecisionBodySchema,
  approvalPolicyBodySchema,
  approvalPolicyResponseSchema,
  approvalReassignmentBodySchema,
  approvalReassignmentOptionsSchema,
  approvalRequestBodySchema,
  dealApprovalStatusSchema,
  dashboardSummarySchema,
  myWorkQuerySchema,
  myWorkResponseSchema,
  type CreateDealBody,
  type ApprovalAbsence,
  type ApprovalDelegation,
  type ApprovalReassignmentOptions,
  type Stage,
  type UpdateDealBody,
} from '@dpt/shared';

import { sessionRead, sessionRequest } from '../auth/api';

export async function readDeals(query: URLSearchParams) {
  return dealListResponseSchema.parse(await sessionRead(`/deals?${query.toString()}`));
}

export async function readMyWork(query: URLSearchParams) {
  const parsed = myWorkQuerySchema.parse(Object.fromEntries(query.entries()));
  const params = new URLSearchParams({
    limit: String(parsed.limit),
    offset: String(parsed.offset),
  });
  return myWorkResponseSchema.parse(await sessionRead(`/deals/my-work?${params.toString()}`));
}

export async function readDashboardSummary() {
  return dashboardSummarySchema.parse(await sessionRead('/deals/dashboard-summary'));
}

export async function readDeal(dealId: string) {
  return dealDetailResponseSchema.parse(await sessionRead(`/deals/${dealId}`));
}

export async function readDealApprovalStatus(dealId: string) {
  return dealApprovalStatusSchema.parse(await sessionRead(`/deals/${dealId}/approval`));
}

export async function requestDealApproval(dealId: string, expectedVersion: number): Promise<void> {
  await sessionRequest(
    `/deals/${dealId}/approval-requests`,
    'POST',
    approvalRequestBodySchema.parse({ expectedVersion }),
  );
}

export async function decideDealApproval(
  requestId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<void> {
  await sessionRequest(
    `/approval-requests/${requestId}/decisions`,
    'POST',
    approvalDecisionBodySchema.parse({ decision, ...(reason === undefined ? {} : { reason }) }),
  );
}

export async function readDealApprovalPolicy() {
  return approvalPolicyResponseSchema.parse(await sessionRead('/approval-policy'));
}

export async function configureDealApprovalPolicy(
  requiredApprovals: number,
  delegationEnabled: boolean,
): Promise<void> {
  await sessionRequest(
    '/approval-policy',
    'PUT',
    approvalPolicyBodySchema.parse({ requiredApprovals, delegationEnabled }),
  );
}

export async function readApprovalAbsences(): Promise<ApprovalAbsence[]> {
  return approvalAbsencesResponseSchema.parse(await sessionRead('/approval-absences'));
}

export async function setApprovalAbsence(startsAt: string, endsAt: string): Promise<void> {
  await sessionRequest(
    '/approval-absences',
    'POST',
    approvalAbsenceBodySchema.parse({ startsAt, endsAt }),
  );
}

export async function cancelApprovalAbsence(absenceId: string): Promise<void> {
  await sessionRequest(`/approval-absences/${absenceId}`, 'DELETE');
}

export async function readApprovalDelegations(): Promise<ApprovalDelegation[]> {
  return approvalDelegationsResponseSchema.parse(await sessionRead('/approval-delegations'));
}

export async function readEligibleApprovalDelegates() {
  return approvalDelegateOptionsSchema.parse(await sessionRead('/approval-delegation-options'));
}

export async function setApprovalDelegation(
  delegateMembershipId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  await sessionRequest(
    '/approval-delegations',
    'POST',
    approvalDelegationBodySchema.parse({ delegateMembershipId, startsAt, endsAt }),
  );
}

export async function cancelApprovalDelegation(delegationId: string): Promise<void> {
  await sessionRequest(`/approval-delegations/${delegationId}`, 'DELETE');
}

export async function readApprovalReassignmentOptions(
  requestId: string,
): Promise<ApprovalReassignmentOptions> {
  return approvalReassignmentOptionsSchema.parse(
    await sessionRead(`/approval-requests/${requestId}/reassignment-options`),
  );
}

export async function reassignApprovalApprover(
  requestId: string,
  fromMembershipId: string,
  toMembershipId: string,
): Promise<void> {
  await sessionRequest(
    `/approval-requests/${requestId}/reassignments`,
    'POST',
    approvalReassignmentBodySchema.parse({ fromMembershipId, toMembershipId }),
  );
}

export async function readDealActivity(
  dealId: string,
  query: { readonly limit?: number; readonly beforeSeq?: string } = {},
) {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.beforeSeq !== undefined) params.set('beforeSeq', query.beforeSeq);
  const suffix = params.size ? `?${params.toString()}` : '';
  return dealActivityResponseSchema.parse(await sessionRead(`/deals/${dealId}/activity${suffix}`));
}

export async function postDealNote(dealId: string, body: string): Promise<void> {
  await sessionRequest(`/deals/${dealId}/notes`, 'POST', createNoteBodySchema.parse({ body }));
}

export async function createDeal(body: CreateDealBody): Promise<void> {
  await sessionRequest('/deals', 'POST', body);
}

export async function moveDealStage(
  dealId: string,
  toStage: Stage,
  expectedVersion: number,
): Promise<void> {
  await sessionRequest(`/deals/${dealId}/stage`, 'POST', { toStage, expectedVersion });
}

export async function updateDeal(dealId: string, body: UpdateDealBody): Promise<void> {
  await sessionRequest(`/deals/${dealId}`, 'PUT', body);
}
