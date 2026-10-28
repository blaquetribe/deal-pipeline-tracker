import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ONBOARDING_STEPS } from './onboarding';

const stepSchema = z.object({
  position: z.number().int(),
  step: z.string(),
  required: z.boolean(),
});
const fixtureSchema = z.object({
  flows: z.object({ owner: z.array(stepSchema), invitee: z.array(stepSchema) }),
});
const fixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../fixtures/onboarding-steps.json', import.meta.url)),
      'utf8',
    ),
  ),
);

describe('onboarding flow mirror', () => {
  it('matches the SQL fixture for the owner and invitee step order and requirements', () => {
    expect(
      ONBOARDING_STEPS.owner.map(({ position, step, required }) => ({ position, step, required })),
    ).toEqual(fixture.flows.owner);
    expect(
      ONBOARDING_STEPS.invitee.map(({ position, step, required }) => ({
        position,
        step,
        required,
      })),
    ).toEqual(fixture.flows.invitee);
  });
});
