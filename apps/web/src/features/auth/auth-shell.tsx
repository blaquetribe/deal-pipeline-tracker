import type { ReactNode } from 'react';

export function AuthShell({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100svh-2rem)] items-center justify-center sm:min-h-[calc(100svh-3rem)] xl:min-h-[calc(100svh-4rem)]">
      <section className="material-card w-full max-w-lg p-6 sm:p-8">
        <p className="text-sm font-medium text-brand-fg">Deal Pipeline Tracker</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-fg-muted">{description}</p>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}
