import { ONBOARDING_STEPS } from '@dpt/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Onboarding } from '../../../features/auth';

export const metadata: Metadata = { title: 'Account setup | Deal Pipeline Tracker' };

const STEPS: ReadonlySet<string> = new Set(
  Object.values(ONBOARDING_STEPS)
    .flat()
    .map(({ step }) => step),
);

export default async function OnboardingStepPage({
  params,
}: {
  readonly params: Promise<{ readonly step: string }>;
}) {
  const { step } = await params;
  if (!STEPS.has(step)) notFound();
  return <Onboarding />;
}
