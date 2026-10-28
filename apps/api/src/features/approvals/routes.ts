import {
  approvalDecisionBodySchema,
  approvalPolicyBodySchema,
  approvalRequestBodySchema,
  dealApprovalStatusSchema,
} from '@dpt/shared';
import { z } from 'zod';

import { HttpError } from '../../http/errors';
import { noBody, sessionRoute, type HttpDeps, type Route } from '../../http/route';

const uuidSchema = z.uuid();

export interface ApprovalRoutesOptions {
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
}

export function createApprovalRoutes({ userRpc }: ApprovalRoutesOptions): Route[] {
  const status = sessionRoute({
    method: 'GET',
    path: '/deals/:dealId/approval',
    body: noBody,
    permission: 'deal.view',
    handler: async ({ params, session }) => {
      const dealId = uuidSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      return {
        body: dealApprovalStatusSchema.parse(
          await userRpc.call('deal_approval_status', { p_deal: dealId.data }, session.accessToken),
        ),
      };
    },
  });

  const request = sessionRoute({
    method: 'POST',
    path: '/deals/:dealId/approval-requests',
    body: approvalRequestBodySchema,
    permission: 'deal.request_approval',
    handler: async ({ params, body, session }) => {
      const dealId = uuidSchema.safeParse(params.dealId);
      if (!dealId.success) {
        throw new HttpError(400, 'invalid_request', 'The deal id is invalid.');
      }
      const requestId = uuidSchema.parse(
        await userRpc.call(
          'request_approval',
          { p_deal: dealId.data, p_expected_version: body.expectedVersion },
          session.accessToken,
        ),
      );
      return { status: 201, body: { requestId } };
    },
  });

  const decide = sessionRoute({
    method: 'POST',
    path: '/approval-requests/:requestId/decisions',
    body: approvalDecisionBodySchema,
    permission: 'approval.decide',
    handler: async ({ params, body, session }) => {
      const requestId = uuidSchema.safeParse(params.requestId);
      if (!requestId.success) {
        throw new HttpError(400, 'invalid_request', 'The approval request id is invalid.');
      }
      const result = z.enum(['pending', 'approved', 'rejected']).parse(
        await userRpc.call(
          'decide_approval',
          {
            p_request: requestId.data,
            p_decision: body.decision,
            p_reason: body.reason ?? null,
          },
          session.accessToken,
        ),
      );
      return { body: { status: result } };
    },
  });

  const configure = sessionRoute({
    method: 'PUT',
    path: '/approval-policy',
    body: approvalPolicyBodySchema,
    permission: 'role.manage',
    handler: async ({ body, session }) => {
      if (!session.tenantId) {
        throw new HttpError(
          409,
          'tenant_required',
          'Choose an organisation to configure approvals.',
        );
      }
      await userRpc.call(
        'configure_approval_policy',
        { p_tenant: session.tenantId, p_required_approvals: body.requiredApprovals },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  return [status, request, decide, configure];
}

export function mountApprovalRoutes(
  app: Parameters<Route['mount']>[0],
  deps: HttpDeps,
  options: ApprovalRoutesOptions,
): Route[] {
  const routes = createApprovalRoutes(options);
  for (const route of routes) route.mount(app, deps);
  return routes;
}
