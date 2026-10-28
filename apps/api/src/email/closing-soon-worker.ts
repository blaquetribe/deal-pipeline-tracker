import { z } from 'zod';

import type { AuthMailer } from '../auth/service';
import type { Logger } from '../http/route';

const uuid = z.uuid();
const payloadSchema = z.strictObject({
  dealId: uuid,
  dealName: z.string().min(1).max(200),
  stage: z.string().min(1),
  amount: z.string().regex(/^\d+$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  closeDate: z.iso.date(),
  closeTime: z.string().nullable(),
  timeZone: z.string().min(1),
  thresholdDays: z.number().int().positive().optional(),
  overdue: z.boolean().optional(),
  href: z.string().regex(/^\/deals\/[0-9a-f-]+$/i),
});
const outboxRowsSchema = z.array(
  z.strictObject({
    id: uuid,
    tenant_id: uuid,
    user_id: uuid,
    recipient_email: z.email(),
    payload: z.unknown(),
  }),
);

export interface ClosingSoonEmailWorkerOptions {
  readonly rpc: {
    call(name: string, args: Record<string, unknown>): Promise<unknown>;
  };
  readonly mailer: AuthMailer;
  readonly appOrigin: string;
  readonly logger: Logger;
}

export function createClosingSoonEmailWorker({
  rpc,
  mailer,
  appOrigin,
  logger,
}: ClosingSoonEmailWorkerOptions) {
  const origin = new URL(appOrigin).origin;
  let running: Promise<void> | null = null;

  async function processBatch(): Promise<void> {
    let claimed: z.infer<typeof outboxRowsSchema>;
    try {
      claimed = outboxRowsSchema.parse(
        await rpc.call('claim_closing_soon_emails', { p_limit: 100 }),
      );
    } catch (error) {
      logger.error('closing-soon email claim failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return;
    }

    const groups = new Map<string, typeof claimed>();
    for (const row of claimed) {
      const key = `${row.tenant_id}:${row.user_id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    await Promise.all(
      [...groups.values()].map(async (rows) => {
        const first = rows[0];
        if (!first) return;
        const ids = rows.map((row) => row.id);
        let sent = false;
        try {
          const deals = rows.map((row) => {
            const payload = payloadSchema.parse(row.payload);
            const link = new URL(payload.href, origin);
            if (link.origin !== origin) throw new Error('unsafe closing-soon link');
            return {
              dealName: payload.dealName,
              stage: payload.stage,
              amount: payload.amount,
              currency: payload.currency,
              closeDate: payload.closeDate,
              closeTime: payload.closeTime,
              timeZone: payload.timeZone,
              ...(payload.thresholdDays === undefined
                ? {}
                : { thresholdDays: payload.thresholdDays }),
              ...(payload.overdue === undefined ? {} : { overdue: payload.overdue }),
              link: link.href,
            };
          });
          await mailer.send({ kind: 'closing_soon_digest', to: first.recipient_email, deals });
          sent = true;
        } catch (error) {
          logger.error('closing-soon email delivery failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        }

        try {
          await rpc.call('complete_closing_soon_emails', { p_ids: ids, p_sent: sent });
        } catch (error) {
          logger.error('closing-soon email completion failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        }
      }),
    );
  }

  return {
    run(): Promise<void> {
      if (running) return running;
      running = processBatch().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
