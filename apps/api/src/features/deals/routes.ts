import {
  createDealBodySchema,
  createNoteBodySchema,
  dashboardSummarySchema,
  dealActivityQuerySchema,
  dealActivityResponseSchema,
  dealAssigneesResponseSchema,
  dealDetailResponseSchema,
  dealListQuerySchema,
  dealListResponseSchema,
  moveDealStageBodySchema,
  setDealAssigneesBodySchema,
  updateDealBodySchema,
} from '@dpt/shared';
import { z } from 'zod';

import { HttpError } from '../../http/errors';
import { noBody, sessionRoute, type HttpDeps, type Route } from '../../http/route';

const dealIdSchema = z.uuid();
const assignmentRowsSchema = z.array(
  z.strictObject({
    user_id: z.uuid(),
    role: z.enum(['owner', 'lead', 'member']),
    assigned_at: z.iso.datetime({ offset: true }),
  }),
);
const activityRowsSchema = z.strictObject({
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
        'closing_soon_alert',
      ]),
      body: z.string().min(1).max(10000),
      actor_id: z.uuid().nullable(),
      actor_name: z.string().nullable(),
      actor_email: z.union([z.email(), z.literal('system')]),
      created_at: z.iso.datetime({ offset: true }),
      amends_event_id: z.uuid().nullable(),
    }),
  ),
  hasMore: z.boolean(),
  integrityOk: z.boolean(),
});

export interface DealRoutesOptions {
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
}

export function createDealRoutes({ userRpc }: DealRoutesOptions): Route[] {
  const create = sessionRoute({
    method: 'POST',
    path: '/deals',
    body: createDealBodySchema,
    permission: 'deal.create',
    handler: async ({ body, session }) => {
      if (!session.tenantId) {
        throw new HttpError(
          409,
          'tenant_required',
          'Choose an organisation before creating a deal.',
        );
      }
      const dealId = z.uuid().parse(
        await userRpc.call(
          'create_deal',
          {
            p_tenant: session.tenantId,
            p_name: body.name,
            p_sector: body.sector ?? null,
            p_amount: body.amount ?? null,
            p_currency: body.currency,
            p_expected_close: body.expectedCloseDate ?? null,
          },
          session.accessToken,
        ),
      );
      return { status: 201, body: { dealId } };
    },
  });

  const list = sessionRoute({
    method: 'GET',
    path: '/deals',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ query, session }) => {
      if (!session.tenantId) {
        throw new HttpError(409, 'tenant_required', 'Choose an organisation to view its deals.');
      }
      const entries = [...query.entries()];
      if (new Set(entries.map(([key]) => key)).size !== entries.length) {
        throw new HttpError(400, 'invalid_request', 'Each filter can be supplied only once.');
      }
      const parsed = dealListQuerySchema.safeParse(Object.fromEntries(entries));
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_request', 'Check the deal list filters.');
      }
      return {
        body: dealListResponseSchema.parse(
          await userRpc.call(
            'list_deals',
            {
              p_tenant: session.tenantId,
              p_stage: parsed.data.stage ?? null,
              p_search: parsed.data.search ?? null,
              p_limit: parsed.data.limit,
              p_offset: parsed.data.offset,
            },
            session.accessToken,
          ),
        ),
      };
    },
  });

  const detail = sessionRoute({
    method: 'GET',
    path: '/deals/:dealId',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ params, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      return {
        body: dealDetailResponseSchema.parse(
          await userRpc.call('deal_detail', { p_deal: dealId.data }, session.accessToken),
        ),
      };
    },
  });

  const dashboardSummary = sessionRoute({
    method: 'GET',
    path: '/deals/dashboard-summary',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ session }) => {
      if (!session.tenantId) {
        throw new HttpError(409, 'tenant_required', 'Choose an organisation to view its deals.');
      }
      return {
        body: dashboardSummarySchema.parse(
          await userRpc.call(
            'deal_dashboard_summary',
            { p_tenant: session.tenantId },
            session.accessToken,
          ),
        ),
      };
    },
  });

  const update = sessionRoute({
    method: 'PUT',
    path: '/deals/:dealId',
    body: updateDealBodySchema,
    permission: 'deal.edit',
    handler: async ({ params, body, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const changes: Record<string, unknown> = {};
      if (body.name !== undefined) changes.name = body.name;
      if (body.sector !== undefined) changes.sector = body.sector;
      if (body.amount !== undefined) changes.amount = body.amount;
      if (body.currency !== undefined) changes.currency = body.currency;
      if (body.expectedCloseDate !== undefined)
        changes.expected_close_date = body.expectedCloseDate;
      if (body.expectedCloseTime !== undefined)
        changes.expected_close_time = body.expectedCloseTime;
      const version = z
        .number()
        .int()
        .min(2)
        .parse(
          await userRpc.call(
            'update_deal',
            { p_deal: dealId.data, p_expected_version: body.expectedVersion, p_changes: changes },
            session.accessToken,
          ),
        );
      return { body: { version } };
    },
  });

  const moveStage = sessionRoute({
    method: 'POST',
    path: '/deals/:dealId/stage',
    body: moveDealStageBodySchema,
    permission: 'deal.edit',
    handler: async ({ params, body, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const version = z
        .number()
        .int()
        .min(2)
        .parse(
          await userRpc.call(
            'move_stage',
            {
              p_deal: dealId.data,
              p_to: body.toStage,
              p_expected_version: body.expectedVersion,
              p_reason: null,
            },
            session.accessToken,
          ),
        );
      return { body: { version } };
    },
  });

  const activity = sessionRoute({
    method: 'GET',
    path: '/deals/:dealId/activity',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ params, query, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const entries = [...query.entries()];
      if (new Set(entries.map(([key]) => key)).size !== entries.length) {
        throw new HttpError(
          400,
          'invalid_request',
          'Each activity filter can be supplied only once.',
        );
      }
      const parsed = dealActivityQuerySchema.safeParse(Object.fromEntries(entries));
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_request', 'Check the activity page options.');
      }
      const response = activityRowsSchema.parse(
        await userRpc.call(
          'deal_activity',
          {
            p_deal: dealId.data,
            p_limit: parsed.data.limit,
            p_before_seq: parsed.data.beforeSeq ?? null,
          },
          session.accessToken,
        ),
      );
      return {
        body: dealActivityResponseSchema.parse({
          events: response.events.map((event) => ({
            seq: event.seq,
            id: event.id,
            kind: event.kind,
            body: event.body,
            actorId: event.actor_id,
            actorName: event.actor_name,
            actorEmail: event.actor_email,
            createdAt: event.created_at,
            amendsEventId: event.amends_event_id,
          })),
          hasMore: response.hasMore,
          integrityOk: response.integrityOk,
        }),
      };
    },
  });

  const postNote = sessionRoute({
    method: 'POST',
    path: '/deals/:dealId/notes',
    body: createNoteBodySchema,
    permission: 'deal.note',
    handler: async ({ params, body, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const eventId = z
        .uuid()
        .parse(
          await userRpc.call(
            'post_event',
            { p_deal: dealId.data, p_kind: 'note', p_body: body.body },
            session.accessToken,
          ),
        );
      return { status: 201, body: { eventId } };
    },
  });

  const listAssignees = sessionRoute({
    method: 'GET',
    path: '/deals/:dealId/assignees',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ params, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const rows = assignmentRowsSchema.parse(
        await userRpc.call('deal_assignees_for_deal', { p_deal: dealId.data }, session.accessToken),
      );
      return {
        body: dealAssigneesResponseSchema.parse({
          assignees: rows.map(({ user_id, role, assigned_at }) => ({
            userId: user_id,
            role,
            assignedAt: assigned_at,
          })),
        }),
      };
    },
  });

  const replaceAssignees = sessionRoute({
    method: 'PUT',
    path: '/deals/:dealId/assignees',
    body: setDealAssigneesBodySchema,
    permission: 'deal.edit',
    handler: async ({ params, body, session }) => {
      const dealId = dealIdSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const version = z
        .number()
        .int()
        .min(2)
        .parse(
          await userRpc.call(
            'set_deal_assignees',
            {
              p_deal: dealId.data,
              p_expected_version: body.version,
              p_assignments: body.assignees.map(({ userId, role }) => ({
                user_id: userId,
                role,
              })),
            },
            session.accessToken,
          ),
        );
      return { body: { version } };
    },
  });

  return [
    create,
    list,
    dashboardSummary,
    detail,
    update,
    moveStage,
    activity,
    postNote,
    listAssignees,
    replaceAssignees,
  ];
}

export function mountDealRoutes(
  app: Parameters<Route['mount']>[0],
  deps: HttpDeps,
  options: DealRoutesOptions,
): Route[] {
  const routes = createDealRoutes(options);
  for (const route of routes) route.mount(app, deps);
  return routes;
}
