import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../http/route';
import {
  createClosingSoonEmailWorker,
  type ClosingSoonEmailWorkerOptions,
} from './closing-soon-worker';

const row = (id: string, dealId: string, userId = 'aaaaaaaa-0000-4000-8000-000000000001') => ({
  id,
  tenant_id: 'cccccccc-0000-4000-8000-000000000001',
  user_id: userId,
  recipient_email: 'recipient@example.test',
  payload: {
    dealId,
    dealName: `Deal ${id}`,
    stage: 'sourcing',
    amount: '9007199254740993',
    currency: 'ZAR',
    closeDate: '2026-11-01',
    closeTime: null,
    timeZone: 'Africa/Johannesburg',
    thresholdDays: 5,
    href: `/deals/${dealId}`,
  },
});

function harness(claimedRows: unknown) {
  const call = vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(
    async (name) => (name === 'claim_closing_soon_emails' ? claimedRows : true),
  );
  const send = vi.fn<
    (input: Parameters<ClosingSoonEmailWorkerOptions['mailer']['send']>[0]) => Promise<void>
  >(async () => undefined);
  const rpc = { call };
  const mailer: ClosingSoonEmailWorkerOptions['mailer'] = { send };
  const error = vi.fn<(message: string, fields?: Record<string, unknown>) => void>();
  const logger: Logger = { info: vi.fn<() => void>(), error };
  const worker = createClosingSoonEmailWorker({
    rpc,
    mailer,
    appOrigin: 'https://tracker.example',
    logger,
  });
  return { worker, call, send, error };
}

describe('closing-soon email worker', () => {
  it('groups a recipient batch into one digest and completes the claimed rows', async () => {
    const { worker, call, send } = harness([
      row('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000011'),
      row('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000012'),
    ]);
    const firstRun = worker.run();
    expect(worker.run()).toBe(firstRun);
    await firstRun;
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      kind: 'closing_soon_digest',
      to: 'recipient@example.test',
      deals: expect.arrayContaining([
        expect.objectContaining({
          dealName: 'Deal bbbbbbbb-0000-4000-8000-000000000001',
          amount: '9007199254740993',
          link: 'https://tracker.example/deals/bbbbbbbb-0000-4000-8000-000000000011',
        }),
      ]),
    });
    expect(call).toHaveBeenCalledWith('complete_closing_soon_emails', {
      p_ids: ['bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'],
      p_sent: true,
    });
  });

  it('requeues failed delivery without logging recipient or payload data', async () => {
    const { worker, call, send, error } = harness([
      row('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000011'),
    ]);
    send.mockRejectedValueOnce(new Error('smtp secret response'));
    await worker.run();
    expect(call).toHaveBeenCalledWith('complete_closing_soon_emails', {
      p_ids: ['bbbbbbbb-0000-4000-8000-000000000001'],
      p_sent: false,
    });
    expect(error).toHaveBeenCalledWith('closing-soon email delivery failed', {
      error: 'Error',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('smtp secret response');
    expect(JSON.stringify(error.mock.calls)).not.toContain('recipient@example.test');
  });

  it('fails closed on invalid payload and handles claim failures', async () => {
    const malformed = row(
      'bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000011',
    );
    malformed.payload.href = 'https://attacker.example';
    const first = harness([malformed]);
    await first.worker.run();
    expect(first.send).not.toHaveBeenCalled();
    expect(first.call).toHaveBeenCalledWith('complete_closing_soon_emails', {
      p_ids: ['bbbbbbbb-0000-4000-8000-000000000001'],
      p_sent: false,
    });

    const failedClaim = harness([]);
    failedClaim.call.mockRejectedValueOnce(new Error('database secret'));
    await failedClaim.worker.run();
    expect(failedClaim.error).toHaveBeenCalledWith('closing-soon email claim failed', {
      error: 'Error',
    });
  });

  it('leaves claimed rows for lease recovery when completion persistence fails', async () => {
    const { worker, call, error } = harness([
      row('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000011'),
    ]);
    call.mockImplementationOnce(async () => [
      row('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000011'),
    ]);
    call.mockRejectedValueOnce(new Error('completion failed'));
    await worker.run();
    expect(error).toHaveBeenCalledWith('closing-soon email completion failed', { error: 'Error' });
  });

  it('handles an empty queue and builds separate digests for distinct recipients', async () => {
    const empty = harness([]);
    await empty.worker.run();
    expect(empty.send).not.toHaveBeenCalled();

    const firstWithThreshold = row(
      'bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000011',
    );
    const { thresholdDays: _thresholdDays, ...firstPayload } = firstWithThreshold.payload;
    const first = { ...firstWithThreshold, payload: firstPayload };
    const secondWithThreshold = row(
      'bbbbbbbb-0000-4000-8000-000000000002',
      'bbbbbbbb-0000-4000-8000-000000000012',
      'aaaaaaaa-0000-4000-8000-000000000002',
    );
    const { thresholdDays: _secondThresholdDays, ...secondPayload } = secondWithThreshold.payload;
    const second = {
      ...secondWithThreshold,
      recipient_email: 'other@example.test',
      payload: secondPayload,
    };
    const multiple = harness([first, second]);
    await multiple.worker.run();
    expect(multiple.send).toHaveBeenCalledTimes(2);
    expect(multiple.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: 'other@example.test', kind: 'closing_soon_digest' }),
    );
  });

  it('rejects malformed claimed row metadata and sanitizes non-Error failures', async () => {
    const invalidRows = harness([
      {
        ...row('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000011'),
        recipient_email: 'not-an-email',
      },
    ]);
    await invalidRows.worker.run();
    expect(invalidRows.error).toHaveBeenCalledWith('closing-soon email claim failed', {
      error: 'ZodError',
    });

    const failedClaim = harness([]);
    failedClaim.call.mockRejectedValueOnce('private database detail');
    await failedClaim.worker.run();
    expect(failedClaim.error).toHaveBeenCalledWith('closing-soon email claim failed', {
      error: 'unknown',
    });
  });
});
