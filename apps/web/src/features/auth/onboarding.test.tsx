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

  it('creates an organisation, saves defaults, and finishes the owner flow', async () => {
    const user = userEvent.setup();
    const states = [
      {
        onboarding: { flow: 'owner', current_step: 'organisation', completed: false, skipped: [] },
      },
      { onboarding: { flow: 'owner', current_step: 'defaults', completed: false, skipped: [] } },
      { onboarding: { flow: 'owner', current_step: 'invite', completed: false, skipped: [] } },
      { onboarding: { flow: 'owner', current_step: 'done', completed: true, skipped: [] } },
    ];
    mocks.pathname = '/onboarding/organisation';
    mocks.sessionRead.mockImplementation(async (path) =>
      path === '/onboarding/state'
        ? states.shift()
        : path === '/roles'
          ? {
              canManageRoles: true,
              roles: [
                {
                  id: 'aaaaaaaa-0000-4000-8000-000000000001',
                  key: 'deal_member',
                  name: 'Deal Team Member',
                  isSystem: true,
                  permissions: ['deal.view'],
                },
              ],
              permissionCatalog: [{ key: 'deal.view', description: 'See deals' }],
            }
          : { invitations: [] },
    );
    render(<Onboarding />);
    await user.type(await screen.findByLabelText('Organisation name'), 'Atlas Capital');
    await user.click(screen.getByRole('button', { name: 'Create organisation' }));
    expect(await screen.findByText('Organisation created.')).toBeInTheDocument();
    const days = await screen.findByLabelText('Closing soon window (days)');
    await user.clear(days);
    await user.type(days, '45');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(await screen.findByRole('heading', { name: 'Invite your team' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(await screen.findByText('Your setup is complete.')).toBeInTheDocument();
    expect(mocks.sessionRequest).toHaveBeenCalledWith('/onboarding/organisation', 'POST', {
      name: 'Atlas Capital',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
    });
    expect(mocks.sessionRequest).toHaveBeenCalledWith('/onboarding/defaults', 'PUT', {
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      closingSoonDays: 45,
    });
  });

  it('offers tenant custom roles in the invite form and never offers Owner', async () => {
    mocks.pathname = '/onboarding/invite';
    mocks.sessionRead.mockImplementation(async (path) => {
      if (path === '/onboarding/state') {
        return {
          onboarding: { flow: 'owner', current_step: 'invite', completed: false, skipped: [] },
        };
      }
      if (path === '/roles') {
        return {
          canManageRoles: true,
          roles: [
            {
              id: 'aaaaaaaa-0000-4000-8000-000000000001',
              key: 'owner',
              name: 'Owner',
              isSystem: true,
              permissions: ['role.manage'],
            },
            {
              id: 'aaaaaaaa-0000-4000-8000-000000000002',
              key: 'custom_abcdefgh',
              name: 'Investment Reviewer',
              isSystem: false,
              permissions: ['deal.view'],
            },
          ],
          permissionCatalog: [{ key: 'deal.view', description: 'See deals' }],
        };
      }
      return { invitations: [] };
    });
    render(<Onboarding />);

    const role = await screen.findByRole('combobox', { name: 'Role' });
    expect(await within(role).findByRole('option', { name: 'Investment Reviewer' })).toHaveValue(
      'custom_abcdefgh',
    );
    expect(within(role).queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
  });

  it('disables invitations and explains when the tenant role catalog cannot load', async () => {
    mocks.pathname = '/onboarding/invite';
    mocks.sessionRead.mockImplementation(async (path) => {
      if (path === '/onboarding/state') {
        return {
          onboarding: { flow: 'owner', current_step: 'invite', completed: false, skipped: [] },
        };
      }
      if (path === '/roles') throw new Error('Role list unavailable.');
      return { invitations: [] };
    });
    render(<Onboarding />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Role list unavailable.');
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
  });

  it('shows safe load/save errors, the no-flow state, and an action error', async () => {
    mocks.sessionRead.mockRejectedValueOnce('unexpected load failure');
    const loadingFailure = render(<Onboarding />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Setup could not be loaded.');
    expect(screen.getByRole('link', { name: 'Continue to the pipeline' })).toHaveAttribute(
      'href',
      '/',
    );
    loadingFailure.unmount();

    mocks.sessionRead.mockResolvedValueOnce({ onboarding: null });
    render(<Onboarding />);
    expect(await screen.findByText('No onboarding flow is active.')).toBeInTheDocument();
    screen.getByRole('link', { name: 'Continue to the pipeline' });
  });

  it('reports save and skip failures and supports skipping defaults', async () => {
    const user = userEvent.setup();
    mocks.sessionRead.mockResolvedValue({
      onboarding: { flow: 'owner', current_step: 'defaults', completed: false, skipped: [] },
    });
    mocks.sessionRequest.mockRejectedValueOnce(new Error('Settings could not be saved.'));
    render(<Onboarding />);
    await user.click(await screen.findByRole('button', { name: 'Save defaults' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved.');
    mocks.sessionRequest.mockRejectedValueOnce('skip failed');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request could not be completed.',
    );
    mocks.sessionRequest.mockRejectedValueOnce('save failed');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes could not be saved.');
  });
});
