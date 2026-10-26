import { describe, expect, it } from 'vitest';

import { parseTheme } from './theme';

describe('parseTheme', () => {
  it('accepts dark', () => {
    expect(parseTheme('dark')).toBe('dark');
  });

  it.each([undefined, '', 'light', 'DARK', 'system', '<script>'])(
    'falls back to light for %s',
    (value) => {
      expect(parseTheme(value)).toBe('light');
    },
  );
});
