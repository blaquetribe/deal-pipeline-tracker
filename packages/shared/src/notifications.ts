import { z } from 'zod';

import { stageSchema } from './stages';

export const notificationSchema = z.strictObject({
  id: z.uuid(),
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
  created_at: z.iso.datetime({ offset: true }),
  read_at: z.iso.datetime({ offset: true }).nullable(),
});

export const notificationListSchema = z.array(notificationSchema);

export type Notification = z.infer<typeof notificationSchema>;
