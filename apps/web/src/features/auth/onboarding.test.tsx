import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/onboarding/profile',
  replace: vi.fn<(path: string) => void>(),
  push: vi.fn<(path: string) => void>(),
  refresh: vi.fn<() => void>(),
  sessionRead: vi.fn<(path: string) => Promise<unknown>>(),
  sessionRequest: vi.fn<(path: string, method: string, body?: unknown) => Promise<unknown>>(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('./api', () => ({
  sessionRead: mocks.sessionRead,
  sessionRequest: mocks.sessionRequest,
}));

import { Onboarding, onboardingPath, SetupStepper, ValidationSummary } from './onboarding';

beforeEach(() => {
  mocks.pathname = '/onboarding/profile';
  mocks.replace.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.sessionRequest.mockReset();
  mocks.sessionRead.mockReset().mockResolvedValue({
    onboarding: { flow: 'owner', current_step: 'profile', completed: false, skipped: [] },
  });
});

describe('onboardingPath', () => {
  it('routes to the database-selected step and returns completed flows to the pipeline', () => {
    expect(
      onboardingPath({
        flow: 'owner',
        current_step: 'organisation',
        completed: false,
        skipped: [],
      }),
    ).toBe('/onboarding/organisation');
    expect(
      onboardingPath({ flow: 'owner', current_step: 'done', completed: true, skipped: [] }),
    ).toBe('/');
  });
});

describe('SetupStepper', () => {
  it('marks the current and skipped owner steps for assistive technology', () => {
    render(
      <SetupStepper
        state={{
          flow: 'owner',
          current_step: 'invite',
          completed: false,
          skipped: ['defaults'],
        }}
      />,
    );

    const list = screen.getByRole('list', { name: 'Setup progress' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'Invite your team',
    );
    expect(within(list).getByText('Pipeline defaults').parentElement).toHaveTextContent('Skipped');
  });

  it('renders the shorter invitee flow', () => {
    render(
      <SetupStepper
        state={{
          flow: 'invitee',
          current_step: 'profile',
          completed: false,
          skipped: [],
        }}
      />,
    );

    const list = screen.getByRole('list', { name: 'Setup progress' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'Your profile',
    );
  });
});

describe('ValidationSummary', () => {
  it('links each validation message to its form field', () => {
    render(
      <ValidationSummary
        problems={[
          { fieldId: 'organisation-name', label: 'Organisation name', message: 'Required' },
          { fieldId: 'organisation-timezone', label: 'Time zone', message: 'Invalid time zone' },
        ]}
      />,
    );

    expect(screen.getByRole('alert')).toHaveAccessibleName('There is a problem');
    expect(screen.getByRole('link', { name: 'Organisation name: Required' })).toHaveAttribute(
      'href',
      '#organisation-name',
    );
    expect(screen.getByRole('link', { name: 'Time zone: Invalid time zone' })).toHaveAttribute(
      'href',
      '#organisation-timezone',
    );
  });

  it('does not render when validation succeeds', () => {
    const { container } = render(<ValidationSummary problems={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Onboarding focus and route behavior', () => {
  it('redirects a mismatched step URL to the database-selected step', async () => {
    mocks.pathname = '/onboarding/organisation';
    render(<Onboarding />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/onboarding/profile'));
  });

  it('focuses the validation summary and links to the invalid field', async () => {
    const user = userEvent.setup();
    render(<Onboarding />);
    const displayName = await screen.findByRole('textbox', { name: 'Display name' });
    await user.type(displayName, '   ');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    const summary = await screen.findByRole('alert');
    await waitFor(() => expect(summary).toHaveFocus());
    expect(
      screen.getByRole('link', { name: 'Display name: Enter a display name.' }),
    ).toHaveAttribute('href', `#${displayName.id}`);
  });
});
