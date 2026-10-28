export const ONBOARDING_STEPS = {
  owner: [
    { position: 1, step: 'profile', required: true, label: 'Your profile' },
    { position: 2, step: 'organisation', required: true, label: 'Create your organisation' },
    { position: 3, step: 'defaults', required: false, label: 'Pipeline defaults' },
    { position: 4, step: 'invite', required: false, label: 'Invite your team' },
    { position: 5, step: 'done', required: true, label: 'Done' },
  ],
  invitee: [
    { position: 1, step: 'profile', required: true, label: 'Your profile' },
    { position: 2, step: 'done', required: true, label: 'Done' },
  ],
} as const;

export type OnboardingFlow = keyof typeof ONBOARDING_STEPS;
