import { describe, expect, it } from 'vitest';

import { formatMinorAmount, majorAmountForInput, parseMajorAmount } from './money';

describe('formatMinorAmount', () => {
  it('formats large minor-unit amounts without converting them to floating point', () => {
    expect(formatMinorAmount('123456789012345', 'ZAR')).toBe('R 1 234 567 890 123,45');
  });

  it('uses the currency precision and labels missing amounts', () => {
    expect(formatMinorAmount('12345', 'JPY')).toBe('JP¥12 345');
    expect(formatMinorAmount(null, 'ZAR')).toBe('Not set');
  });

  it('converts major units to exact minor-unit text without floating-point arithmetic', () => {
    expect(parseMajorAmount('1234567890123.45', 'ZAR')).toBe('123456789012345');
    expect(parseMajorAmount('100', 'JPY')).toBe('100');
    expect(parseMajorAmount('', 'ZAR')).toBeNull();
    expect(() => parseMajorAmount('1.234', 'ZAR')).toThrow(/decimal point/);
  });

  it('converts minor units to canonical decimal input without floating-point arithmetic', () => {
    expect(majorAmountForInput('123456789012345', 'ZAR')).toBe('1234567890123.45');
    expect(majorAmountForInput('125000000', 'JPY')).toBe('125000000');
    expect(majorAmountForInput(null, 'ZAR')).toBe('');
  });
});
