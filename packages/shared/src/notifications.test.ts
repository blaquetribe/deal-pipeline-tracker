import { describe, expect, it } from 'vitest';

import { notificationSchema } from './notifications';

const notification = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  kind: 'closing_soon',
  payload: {
    dealId: 'bbbbbbbb-0000-4000-8000-000000000002',
    dealName: 'Example deal',
    stage: 'sourcing',
    amount: '9007199254740993',
    currency: 'ZAR',
    closeDate: '2026-11-01',
    closeTime: null,
    timeZone: 'Africa/Johannesburg',
    thresholdDays: 5,
    href: '/deals/bbbbbbbb-0000-4000-8000-000000000002',
  },
  created_at: '2026-10-28T10:00:00Z',
  read_at: null,
};

describe('notification schema', () => {
  it('preserves exact money strings and validates safe in-app links', () => {
    const parsed = notificationSchema.parse(notification);
    expect(parsed.kind === 'closing_soon' && parsed.payload.amount).toBe('9007199254740993');
    expect(() =>
      notificationSchema.parse({
        ...notification,
        payload: { ...notification.payload, href: 'https://attacker.example' },
      }),
    ).toThrow(/href/);
  });

  it('rejects malformed alert details and unexpected caller-supplied fields', () => {
    expect(() =>
      notificationSchema.parse({
        ...notification,
        payload: { ...notification.payload, amount: 1000 },
      }),
    ).toThrow(/amount/);
    expect(() => notificationSchema.parse({ ...notification, tenantId: 'spoofed' })).toThrow(
      /tenantId/,
    );
  });

  it('validates approval quorum alerts with only a same-origin deal link', () => {
    const approvalAlert = {
      id: 'bbbbbbbb-0000-4000-8000-000000000003',
      kind: 'approval_quorum_unreachable',
      payload: {
        dealId: 'bbbbbbbb-0000-4000-8000-000000000002',
        dealName: 'Example deal',
        message: 'Approval quorum can no longer be reached.',
        href: '/deals/bbbbbbbb-0000-4000-8000-000000000002',
      },
      created_at: '2026-10-28T10:00:00Z',
      read_at: null,
    };
    expect(notificationSchema.parse(approvalAlert).kind).toBe('approval_quorum_unreachable');
    expect(() =>
      notificationSchema.parse({
        ...approvalAlert,
        payload: {
          ...approvalAlert.payload,
          href: 'https://attacker.example',
        },
      }),
    ).toThrow(/href/);
  });
});
