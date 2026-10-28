import type { Metadata } from 'next';

import { Onboarding } from '../../features/auth';

export const metadata: Metadata = { title: 'Account setup | Deal Pipeline Tracker' };

export default function OnboardingPage() {
  return <Onboarding />;
}
