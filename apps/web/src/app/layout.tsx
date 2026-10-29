import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { parseTheme, THEME_COOKIE } from '../features/theme';

import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Deal Pipeline Tracker',
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  // Theme comes from a cookie so the class is correct in the first HTML: no
  // inline script, no flash, and nothing for the CSP to allow.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="en" className={theme === 'dark' ? 'dark' : ''}>
      <body>
        <a
          className="sr-only rounded-control bg-surface-raised text-fg focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:px-3 focus:py-2"
          href="#main"
        >
          Skip to content
        </a>
        <main id="main" className="p-4 sm:p-6">
          {children}
        </main>
      </body>
    </html>
  );
}
