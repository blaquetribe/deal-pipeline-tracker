import { STAGE_LABELS, type Stage } from '@dpt/shared';

const STAGE_COLORS: Record<Stage, string> = {
  sourcing: 'border-brand/30 bg-brand-soft text-brand-fg',
  screening: 'border-info/30 bg-info-soft text-info-fg',
  due_diligence: 'border-warning/30 bg-warning-soft text-warning-fg',
  ic_review: 'border-accent/30 bg-accent-soft text-accent-fg',
  signed: 'border-success/30 bg-success-soft text-success-fg',
  closed: 'border-info/30 bg-info-soft text-info-fg',
  passed: 'border-line bg-surface-subtle text-fg-muted',
};

export function StageBadge({ stage }: { readonly stage: Stage }) {
  // Status is conveyed by text, never by colour alone.
  return (
    <span
      className={`inline-block rounded-control border px-2.5 py-1 text-xs font-medium ${STAGE_COLORS[stage]}`}
      data-stage={stage}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}
