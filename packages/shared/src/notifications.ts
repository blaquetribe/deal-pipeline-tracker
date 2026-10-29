import { z } from 'zod';

import { stageSchema } from './stages';

const notificationBase = {
  id: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
  read_at: z.iso.datetime({ offset: true }).nullable(),
};

export const notificationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...notificationBase,
    kind: z.literal('closing_soon'),
    payload: z.strictObject({
      dealId: z.uuid(),
      dealName: z.string().min(1).max(200),
      stage: stageSchema,
      amount: z.string().regex(/^\d+$/).nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      closeDate: z.iso.date(),
      closeTime: z.string().nullable(),
      timeZone: z.string().min(1),
      thresholdDays: z.number().int().positive().optional(),
      overdue: z.boolean().optional(),
      href: z.string().regex(/^\/deals\/[0-9a-f-]+$/i),
    }),
  }),
  z.strictObject({
    ...notificationBase,
    kind: z.literal('approval_quorum_unreachable'),
    payload: z.strictObject({
      dealId: z.uuid(),
      dealName: z.string().min(1).max(200),
      message: z.literal('Approval quorum can no longer be reached.'),
      href: z.string().regex(/^\/deals\/[0-9a-f-]+$/i),
    }),
  }),
  z.strictObject({
    ...notificationBase,
    kind: z.literal('approval_sla_escalation'),
    payload: z.strictObject({
      dealId: z.uuid(),
      dealName: z.string().min(1).max(200),
      message: z.literal('IC approval has been waiting for more than 24 hours.'),
      href: z.string().regex(/^\/deals\/[0-9a-f-]+$/i),
    }),
  }),
]);

export const notificationListSchema = z.array(notificationSchema);

export type Notification = z.infer<typeof notificationSchema>;
