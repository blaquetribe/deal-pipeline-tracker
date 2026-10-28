export function formatMinorAmount(amount: string | null, currency: string): string {
  if (amount === null) return 'Not set';

  const currencyFormatter = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const digits =
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const divisor = 10n ** BigInt(digits);
  const minorUnits = BigInt(amount);
  const parts = currencyFormatter.formatToParts(minorUnits / divisor);
  if (digits === 0) return parts.map((part) => part.value).join('');

  const lastInteger = parts.findLastIndex((part) => part.type === 'integer');
  const decimal =
    new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 1 })
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value ?? '.';
  const fraction = (minorUnits % divisor).toString().padStart(digits, '0');
  parts.splice(
    lastInteger + 1,
    0,
    { type: 'decimal', value: decimal },
    { type: 'fraction', value: fraction },
  );
  return parts.map((part) => part.value).join('');
}

export function parseMajorAmount(value: string, currency: string): string | null {
  const input = value.trim();
  if (!input) return null;
  const digits =
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const pattern = digits === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`);
  const match = pattern.exec(input);
  if (!match) throw new Error('Enter a non-negative amount using digits and a decimal point.');
  const scale = 10n ** BigInt(digits);
  const whole = BigInt(match[1] ?? '0');
  const fraction = digits === 0 ? 0n : BigInt((match[2] ?? '').padEnd(digits, '0') || '0');
  const minorUnits = whole * scale + fraction;
  const result = minorUnits.toString();
  if (result.length > 18) throw new Error('That amount is too large.');
  return result;
}

export function majorAmountForInput(amount: string | null, currency: string): string {
  if (amount === null) return '';
  const digits =
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const divisor = 10n ** BigInt(digits);
  const minorUnits = BigInt(amount);
  const whole = (minorUnits / divisor).toString();
  if (digits === 0) return whole;
  const fraction = (minorUnits % divisor).toString().padStart(digits, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
