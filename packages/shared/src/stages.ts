import { z } from 'zod';

/** Pipeline order. `passed` is an outcome reachable from any non-terminal stage. */
export const STAGES = [
  'sourcing',
  'screening',
  'due_diligence',
  'ic_review',
  'signed',
  'closed',
  'passed',
] as const;

export const stageSchema = z.enum(STAGES);

export type Stage = z.infer<typeof stageSchema>;

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  sourcing: 'Sourcing',
  screening: 'Screening',
  due_diligence: 'Due Diligence',
  ic_review: 'IC Review',
  signed: 'Signed',
  closed: 'Closed',
  passed: 'Passed',
};

export function isStage(value: unknown): value is Stage {
  return stageSchema.safeParse(value).success;
}
