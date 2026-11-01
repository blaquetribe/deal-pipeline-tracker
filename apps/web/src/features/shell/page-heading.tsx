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
      className={`page-heading ${spacing === 'compact' ? 'mb-4' : 'mb-5'} flex flex-wrap items-end justify-between gap-3 border-b pb-4`}
    >
      <div className="space-y-1.5">
        {eyebrow ? <div className="page-heading-eyebrow">{eyebrow}</div> : null}
        <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="max-w-3xl text-sm leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
