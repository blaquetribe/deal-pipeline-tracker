import { STAGE_LABELS, type Stage } from '@dpt/shared';

export function StageBadge({ stage }: { readonly stage: Stage }) {
  // Status is conveyed by text, never by colour alone.
  return (
    <span
      className="inline-block rounded-control border border-line bg-surface-subtle px-3 py-1 text-fg"
      data-stage={stage}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}
