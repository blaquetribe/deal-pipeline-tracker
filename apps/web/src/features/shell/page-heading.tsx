import type { ReactNode } from 'react';

interface PageHeadingProps {
  readonly title: string;
  readonly description?: string;
  readonly eyebrow?: ReactNode;
  readonly action?: ReactNode;
  readonly spacing?: 'normal' | 'compact';
}

export function PageHeading({
  title,
  description,
  eyebrow,
  action,
  spacing = 'normal',
}: PageHeadingProps) {
  return (
    <header
      className={`${spacing === 'compact' ? 'mb-4' : 'mb-8'} flex flex-wrap items-end justify-between gap-4 border-b border-line-subtle pb-6`}
    >
      <div className="space-y-2">
        {eyebrow ? <div className="text-sm font-medium text-brand-fg">{eyebrow}</div> : null}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {description ? <p className="max-w-3xl text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
