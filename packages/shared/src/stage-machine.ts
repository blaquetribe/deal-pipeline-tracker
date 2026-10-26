import { isStage, type Stage } from './stages';

/**
 * A mirror of the database stage machine, for UX pre-validation only (E1). The database
 * (`move_stage`) is the authority; `fixtures/stage-machine.json` is run through both so they cannot
 * drift apart.
 */

export type DealField = 'amount' | 'expected_close_date' | 'sector';

export const STAGE_TRANSITIONS: readonly (readonly [Stage, Stage])[] = [
  ['sourcing', 'screening'],
  ['screening', 'due_diligence'],
  ['due_diligence', 'ic_review'],
  ['ic_review', 'due_diligence'],
  ['signed', 'closed'],
  ['sourcing', 'passed'],
  ['screening', 'passed'],
  ['due_diligence', 'passed'],
  ['ic_review', 'passed'],
  ['signed', 'passed'],
];

const SECTOR_AND_AMOUNT: readonly DealField[] = ['amount', 'sector'];
const WITH_CLOSE_DATE: readonly DealField[] = ['amount', 'expected_close_date', 'sector'];

export const STAGE_REQUIREMENTS: Readonly<Partial<Record<Stage, readonly DealField[]>>> = {
  screening: SECTOR_AND_AMOUNT,
  due_diligence: WITH_CLOSE_DATE,
  ic_review: WITH_CLOSE_DATE,
  signed: WITH_CLOSE_DATE,
  closed: WITH_CLOSE_DATE,
};

export type MoveCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'transition_not_allowed' }
  | { readonly ok: false; readonly code: 'missing_fields'; readonly fields: readonly string[] };

/** `present` lists the deal fields that currently hold a value. */
export function evaluateMove(from: string, to: string, present: readonly string[]): MoveCheck {
  const allowed =
    isStage(from) && isStage(to) && STAGE_TRANSITIONS.some(([a, b]) => a === from && b === to);
  if (!allowed || !isStage(to)) {
    return { ok: false, code: 'transition_not_allowed' };
  }

  const have = new Set(present);
  const missing = (STAGE_REQUIREMENTS[to] ?? []).filter((field) => !have.has(field));
  return missing.length === 0
    ? { ok: true }
    : { ok: false, code: 'missing_fields', fields: missing };
}
