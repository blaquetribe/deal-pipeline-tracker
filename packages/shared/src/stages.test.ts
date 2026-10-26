import { describe, expect, it } from 'vitest';

import { isStage, STAGE_LABELS, STAGES } from './stages';

describe('stages', () => {
  it('lists the pipeline in order with passed as the outcome', () => {
    expect(STAGES).toEqual([
      'sourcing',
      'screening',
      'due_diligence',
      'ic_review',
      'signed',
      'closed',
      'passed',
    ]);
  });

  it('has a human label for every stage', () => {
    for (const stage of STAGES) {
      expect(STAGE_LABELS[stage]).not.toBe('');
    }
  });

  it.each([...STAGES])('accepts %s', (value) => {
    expect(isStage(value)).toBe(true);
  });

  it.each([undefined, null, '', 'Sourcing', 'archived', 42, {}])('rejects %s', (value) => {
    expect(isStage(value)).toBe(false);
  });
});
