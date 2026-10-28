import {
  dealListResponseSchema,
  dealDetailResponseSchema,
  dealActivityResponseSchema,
  createNoteBodySchema,
  dashboardSummarySchema,
  type CreateDealBody,
  type Stage,
  type UpdateDealBody,
} from '@dpt/shared';

import { sessionRead, sessionRequest } from '../auth/api';

export async function readDeals(query: URLSearchParams) {
  return dealListResponseSchema.parse(await sessionRead(`/deals?${query.toString()}`));
}

export async function readDashboardSummary() {
  return dashboardSummarySchema.parse(await sessionRead('/deals/dashboard-summary'));
}

export async function readDeal(dealId: string) {
  return dealDetailResponseSchema.parse(await sessionRead(`/deals/${dealId}`));
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
