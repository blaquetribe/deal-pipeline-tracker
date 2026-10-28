import { describe, expect, it } from 'vitest';

import { daysUntil, formatCloseCountdown } from './countdown';

describe('closing countdown', () => {
  it('calculates calendar days in the tenant zone across day boundaries', () => {
    expect(
      daysUntil('2027-01-01', new Date('2026-12-31T22:30:00.000Z'), 'Africa/Johannesburg'),
    ).toBe(0);
    expect(
      daysUntil('2027-01-02', new Date('2026-12-31T22:30:00.000Z'), 'Africa/Johannesburg'),
    ).toBe(1);
    expect(
      daysUntil('2026-12-31', new Date('2026-12-31T22:30:00.000Z'), 'Africa/Johannesburg'),
    ).toBe(-1);
    expect(daysUntil('2027-03-15', new Date('2027-03-14T16:00:00.000Z'), 'America/New_York')).toBe(
      1,
    );
  });

  it('formats the agreed countdown ladder without second-level precision', () => {
    const now = new Date('2027-01-01T09:18:59.000Z');
    expect(formatCloseCountdown(12, null, now)).toBe('12 days left');
    expect(formatCloseCountdown(1, null, now)).toBe('Closes tomorrow');
    expect(formatCloseCountdown(1, '2027-01-02T12:00:00.000Z', now, 'Africa/Johannesburg')).toBe(
      'Closes tomorrow at 14:00',
    );
    expect(formatCloseCountdown(0, null, now)).toBe('Closes today');
    expect(formatCloseCountdown(0, '2027-01-01T15:39:00.000Z', now)).toBe('Closes in 6h 20m');
    expect(formatCloseCountdown(0, '2027-01-01T10:19:00.000Z', now)).toBe('Closes in 1h');
    expect(formatCloseCountdown(0, '2027-01-01T10:00:00.000Z', now)).toBe('Closes in 41m');
    expect(formatCloseCountdown(0, '2027-01-01T08:00:00.000Z', now)).toBe('Overdue by 1h 18m');
    expect(formatCloseCountdown(0, '2027-01-01T08:18:59.000Z', now)).toBe('Overdue by 1h');
    expect(formatCloseCountdown(-3, null, now)).toBe('3 days overdue');
  });
});
