import { z } from 'zod';

import { stageSchema } from './stages';

export const dashboardSummarySchema = z.strictObject({
  serverNow: z.iso.datetime({ offset: true }),
  nextMidnightAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(100),
  windowDays: z.number().int().min(1).max(365),
  pipelineByStage: z.array(
    z.strictObject({ stage: stageSchema, count: z.number().int().nonnegative() }),
  ),
  totalsByCurrency: z.array(
    z.strictObject({ currency: z.string().regex(/^[A-Z]{3}$/), amount: z.string().regex(/^\d+$/) }),
  ),
  closingSoonCount: z.number().int().nonnegative(),
  closingSoon: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string().min(1).max(200),
      stage: stageSchema,
      amount: z.string().regex(/^\d+$/).nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      expectedCloseDate: z.iso.date(),
      expectedCloseTime: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/)
        .nullable(),
      closesInDays: z.number().int(),
      closesAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
});

export const dealAssigneeRoleSchema = z.enum(['owner', 'lead', 'member']);
export const dealAssigneeSchema = z.strictObject({
  userId: z.uuid(),
  role: dealAssigneeRoleSchema,
});

export const createDealBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  sector: z.string().trim().min(1).max(100).nullable().optional(),
  amount: z
    .string()
    .regex(/^\d{1,18}$/)
    .nullable()
    .optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('ZAR'),
  expectedCloseDate: z.iso.date().nullable().optional(),
});

export const moveDealStageBodySchema = z.strictObject({
  toStage: stageSchema,
  expectedVersion: z.number().int().min(1),
});

export const updateDealBodySchema = z
  .strictObject({
    expectedVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    sector: z.string().trim().min(1).max(100).nullable().optional(),
    amount: z
      .string()
      .regex(/^\d{1,18}$/)
      .nullable()
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    expectedCloseDate: z.iso.date().nullable().optional(),
    expectedCloseTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/)
      .nullable()
      .optional(),
  })
  .superRefine((body, context) => {
    if (
      !('name' in body) &&
      !('sector' in body) &&
      !('amount' in body) &&
      !('currency' in body) &&
      !('expectedCloseDate' in body) &&
      !('expectedCloseTime' in body)
    ) {
      context.addIssue({ code: 'custom', message: 'Provide at least one field to update.' });
    }
  });

export const setDealAssigneesBodySchema = z
  .strictObject({
    version: z.number().int().min(1),
    assignees: z.array(dealAssigneeSchema).max(50),
  })
  .superRefine(({ assignees }, context) => {
    const users = new Set<string>();
    const uniqueRoles = new Set<string>();
    for (const [index, assignee] of assignees.entries()) {
      if (users.has(assignee.userId)) {
        context.addIssue({
          code: 'custom',
          path: ['assignees', index, 'userId'],
          message: 'A person can have one assignment role per deal.',
        });
      }
      users.add(assignee.userId);
      if (assignee.role !== 'member' && uniqueRoles.has(assignee.role)) {
        context.addIssue({
          code: 'custom',
          path: ['assignees', index, 'role'],
          message: `A deal can have only one ${assignee.role} assignee.`,
        });
      }
      uniqueRoles.add(assignee.role);
    }
  });

export const dealAssigneesResponseSchema = z.object({
  assignees: z.array(
    z.strictObject({
      userId: z.uuid(),
      role: dealAssigneeRoleSchema,
      assignedAt: z.iso.datetime({ offset: true }),
    }),
  ),
});

export const dealListQuerySchema = z.strictObject({
  stage: stageSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const dealSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  stage: stageSchema,
  version: z.number().int().min(1),
  sector: z.string().nullable(),
  amount: z.string().regex(/^\d+$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expected_close_date: z.iso.date().nullable(),
  expected_close_time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/)
    .nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

export const dealDetailResponseSchema = dealSchema;

export const dealListResponseSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  items: z.array(dealSchema),
});

export const dealActivityQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeSeq: z.string().regex(/^\d+$/).optional(),
});

export const dealActivityResponseSchema = z.strictObject({
  events: z.array(
    z.strictObject({
      seq: z.string().regex(/^\d+$/),
      id: z.uuid(),
      kind: z.enum([
        'note',
        'field_change',
        'stage_change',
        'decision',
        'approval_decision',
        'correction',
      ]),
      body: z.string().min(1).max(10000),
      actorId: z.uuid(),
      actorName: z.string().nullable(),
      actorEmail: z.email(),
      createdAt: z.iso.datetime({ offset: true }),
      amendsEventId: z.uuid().nullable(),
    }),
  ),
  hasMore: z.boolean(),
  integrityOk: z.boolean(),
});

export const createNoteBodySchema = z.strictObject({
  body: z.string().trim().min(1).max(10000),
});

export const approvalRequestBodySchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
});

export const approvalDecisionBodySchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(2000).optional(),
});

export const approvalPolicyBodySchema = z.strictObject({
  requiredApprovals: z.number().int().min(1).max(50),
});

export const dealApprovalStatusSchema = z.strictObject({
  requestId: z.uuid().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']).nullable(),
  requiredApprovals: z.number().int().min(1).nullable(),
  configuredApprovals: z.number().int().min(1).nullable(),
  approvedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  currentUserDecision: z.enum(['approve', 'reject']).nullable(),
  canRequest: z.boolean(),
  canDecide: z.boolean(),
  canConfigure: z.boolean(),
});

export type DealAssignee = z.infer<typeof dealAssigneeSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type CreateDealBody = z.infer<typeof createDealBodySchema>;
export type MoveDealStageBody = z.infer<typeof moveDealStageBodySchema>;
export type UpdateDealBody = z.infer<typeof updateDealBodySchema>;
export type Deal = z.infer<typeof dealSchema>;
export type DealActivityQuery = z.infer<typeof dealActivityQuerySchema>;
export type DealActivityResponse = z.infer<typeof dealActivityResponseSchema>;
export type SetDealAssigneesBody = z.infer<typeof setDealAssigneesBodySchema>;
export type DealAssigneesResponse = z.infer<typeof dealAssigneesResponseSchema>;
export type DealListQuery = z.infer<typeof dealListQuerySchema>;
export type DealListResponse = z.infer<typeof dealListResponseSchema>;
export type DealApprovalStatus = z.infer<typeof dealApprovalStatusSchema>;
