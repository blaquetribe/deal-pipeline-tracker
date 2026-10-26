export const THEME_COOKIE = 'theme';

export type Theme = 'light' | 'dark';

/** Parse the theme cookie; anything unrecognised falls back to light. */
export function parseTheme(value: string | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}
