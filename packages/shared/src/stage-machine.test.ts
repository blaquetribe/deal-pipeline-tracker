import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { evaluateMove, STAGE_REQUIREMENTS, STAGE_TRANSITIONS } from './stage-machine';

// The same file is read by supabase/tests/07_stage_parity.test.sql, so the TypeScript mirror and the
// database functions are held to one table of cases (E1).
const fixtureSchema = z.object({
  transitions: z.array(z.tuple([z.string(), z.string()])),
  requirements: z.record(z.string(), z.array(z.string())),
  cases: z.array(
    z.object({
      name: z.string(),
      from: z.string(),
      to: z.string(),
      present: z.array(z.string()),
      expected: z.enum(['ok', 'transition_not_allowed', 'missing_fields']),
      missing: z.array(z.string()).optional(),
    }),
  ),
});

const fixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/stage-machine.json', import.meta.url)), 'utf8'),
  ),
);

describe('stage machine mirror', () => {
  it('has the same transitions as the fixture (and so as the database)', () => {
    expect(STAGE_TRANSITIONS.map((t) => t.join('>')).toSorted()).toEqual(
      fixture.transitions.map((t) => t.join('>')).toSorted(),
    );
  });

  it('has the same required fields as the fixture', () => {
    const normalised = Object.fromEntries(
      Object.entries(STAGE_REQUIREMENTS).map(([stage, fields]) => [stage, fields.toSorted()]),
    );
    expect(normalised).toEqual(fixture.requirements);
  });

  it.each(fixture.cases)('$name', (testCase) => {
    const expected = {
      ok: { ok: true },
      transition_not_allowed: { ok: false, code: 'transition_not_allowed' },
      missing_fields: { ok: false, code: 'missing_fields', fields: testCase.missing },
    }[testCase.expected];

    expect(evaluateMove(testCase.from, testCase.to, testCase.present)).toEqual(expected);
  });
});
