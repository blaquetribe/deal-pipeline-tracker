import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readAssignableRoles: vi.fn<() => Promise<unknown>>(),
  readSession: vi.fn<(path: string) => Promise<unknown>>(),
  request:
    vi.fn<(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<unknown>>(),
  readTeamMembers: vi.fn<() => Promise<unknown>>(),
  readAuthSession: vi.fn<() => Promise<unknown>>(),
  grantRole: vi.fn<(userId: string, body: { roleKey: string }) => Promise<void>>(),
  revokeRole: vi.fn<(userId: string, body: { roleKey: string }) => Promise<void>>(),
  deactivateMember: vi.fn<(userId: string) => Promise<void>>(),
}));
vi.mock('./api', () => ({
  sessionRead: mocks.readSession,
  sessionRequest: mocks.request,
  readAssignableRoles: mocks.readAssignableRoles,
  readTeamMembers: mocks.readTeamMembers,
  readAuthSession: mocks.readAuthSession,
  grantTeamMemberRole: mocks.grantRole,
  revokeTeamMemberRole: mocks.revokeRole,
  deactivateTeamMember: mocks.deactivateMember,
}));

import { TeamManagement } from './team-management';

describe('TeamManagement', () => {
  beforeEach(() => {
    mocks.readAssignableRoles.mockReset().mockResolvedValue({
      canManageRoles: true,
      roles: [
        { id: 'owner-id', key: 'owner', name: 'Owner' },
        { id: 'admin-id', key: 'admin', name: 'Admin' },
        { id: 'lead-id', key: 'deal_lead', name: 'Deal Lead' },
        { id: 'member-id', key: 'deal_member', name: 'Deal Team Member' },
        { id: 'ic-id', key: 'ic_member', name: 'IC Member' },
        { id: 'observer-id', key: 'observer_compliance', name: 'Observer / Compliance' },
      ],
    });
    mocks.readSession.mockReset().mockResolvedValue({ invitations: [] });
    mocks.request.mockReset().mockResolvedValue({ sent: true });
    mocks.readTeamMembers.mockReset().mockResolvedValue({
      members: [
        {
          userId: 'self-id',
          email: 'owner@example.test',
          fullName: 'Tara Owner',
          deactivatedAt: null,
          roles: [{ key: 'owner', name: 'Owner', isSystem: true }],
        },
        {
          userId: 'member-id',
          email: 'member@example.test',
          fullName: 'Mina Member',
          deactivatedAt: null,
          roles: [
            { key: 'deal_member', name: 'Deal Team Member', isSystem: true },
            { key: 'ic_member', name: 'IC Member', isSystem: true },
          ],
        },
      ],
    });
    mocks.readAuthSession.mockReset().mockResolvedValue({ user: { id: 'self-id' } });
    mocks.grantRole.mockReset().mockResolvedValue(undefined);
    mocks.revokeRole.mockReset().mockResolvedValue(undefined);
    mocks.deactivateMember.mockReset().mockResolvedValue(undefined);
  });

  it('lets an organisation manager invite a teammate with a selected role', async () => {
    const user = userEvent.setup();
    render(<TeamManagement />);
    await user.type(await screen.findByLabelText('Work email'), 'new.member@example.test');
    await user.selectOptions(screen.getByLabelText('Role after acceptance'), 'deal_lead');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/onboarding/invitations', 'POST', {
        email: 'new.member@example.test',
        roleKey: 'deal_lead',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to new.member@example.test as Deal Lead.',
    );
    expect(
      within(screen.getByLabelText('Role after acceptance')).queryByRole('option', {
        name: 'Owner',
      }),
    ).not.toBeInTheDocument();
  });

  it('reports a permission or network failure without losing the form', async () => {
    mocks.readAssignableRoles.mockRejectedValueOnce(
      new Error('You do not have permission to manage invitations.'),
    );
    render(<TeamManagement />);
    expect(await screen.findByRole('alert')).toHaveTextContent('permission to manage invitations');
    expect(screen.getByLabelText('Work email')).toBeEnabled();
  });

  it('validates the invitation and reports a rejected invitation request', async () => {
    const user = userEvent.setup();
    render(<TeamManagement />);
    const form = await screen
      .findByRole('button', { name: 'Send invitation' })
      .then((button) => button.closest('form'));
    expect(form).not.toBeNull();
    await user.type(screen.getByLabelText('Work email'), 'invalid');
    await user.selectOptions(screen.getByLabelText('Role after acceptance'), 'deal_lead');
    fireEvent.submit(form!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/email/i);
    expect(mocks.request).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Work email'));
    await user.type(screen.getByLabelText('Work email'), 'new.member@example.test');
    mocks.request.mockRejectedValueOnce(new Error('Invitation delivery is unavailable.'));
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invitation delivery is unavailable.',
    );
  });

  it('hides role administration but preserves safe assignment choices for a member manager', async () => {
    mocks.readAssignableRoles.mockResolvedValueOnce({
      canManageRoles: false,
      roles: [
        { id: 'lead-id', key: 'deal_lead', name: 'Deal Lead' },
        { id: 'member-id', key: 'deal_member', name: 'Deal Team Member' },
        { id: 'ic-id', key: 'ic_member', name: 'IC Member' },
      ],
    });
    render(<TeamManagement />);
    await screen.findByLabelText('Role after acceptance');
    expect(screen.queryByRole('link', { name: 'Create or review roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'IC Member' })).toBeInTheDocument();
  });

  it('shows accepted members, protects your own roles, and supports role changes and deactivation', async () => {
    const user = userEvent.setup();
    render(<TeamManagement />);
    const member = await screen.findByRole('heading', { name: 'Mina Member' });
    const row = member.closest('li');
    expect(row).not.toBeNull();
    expect(screen.getByText('owner@example.test')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Remove Owner from Tara Owner/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(within(row!).getByLabelText('Add role to Mina Member'), 'deal_lead');
    await user.click(within(row!).getByRole('button', { name: 'Add role' }));
    await waitFor(() =>
      expect(mocks.grantRole).toHaveBeenCalledWith('member-id', { roleKey: 'deal_lead' }),
    );

    const refreshedMemberRow = screen.getByRole('heading', { name: 'Mina Member' }).closest('li');
    expect(refreshedMemberRow).not.toBeNull();
    await user.click(
      within(refreshedMemberRow!).getByRole('button', {
        name: 'Remove IC Member from Mina Member',
      }),
    );
    await waitFor(() =>
      expect(mocks.revokeRole).toHaveBeenCalledWith('member-id', { roleKey: 'ic_member' }),
    );

    const latestMemberRow = screen.getByRole('heading', { name: 'Mina Member' }).closest('li');
    expect(latestMemberRow).not.toBeNull();
    await user.click(within(latestMemberRow!).getByRole('button', { name: 'Deactivate' }));
    await user.click(within(latestMemberRow!).getByRole('button', { name: 'Confirm deactivate' }));
    await waitFor(() => expect(mocks.deactivateMember).toHaveBeenCalledWith('member-id'));
  });

  it('explains roster restrictions and empty role states', async () => {
    mocks.readAssignableRoles.mockResolvedValueOnce({
      canManageRoles: false,
      roles: [{ id: 'member-id', key: 'deal_member', name: 'Deal Team Member' }],
    });
    mocks.readTeamMembers.mockResolvedValueOnce({
      members: [
        {
          userId: 'self-id',
          email: 'owner@example.test',
          fullName: 'Tara Owner',
          deactivatedAt: null,
          roles: [],
        },
        {
          userId: 'blocked-id',
          email: 'blocked@example.test',
          fullName: 'Privileged Member',
          deactivatedAt: null,
          roles: [{ key: 'owner', name: 'Owner', isSystem: true }],
        },
        { userId: 'empty-id', email: null, fullName: null, deactivatedAt: null, roles: [] },
        {
          userId: 'inactive-id',
          email: 'inactive@example.test',
          fullName: 'Inactive Member',
          deactivatedAt: '2026-10-01T00:00:00Z',
          roles: [],
        },
      ],
    });
    render(<TeamManagement />);

    expect(
      await screen.findByText(
        'Only an Owner can change access for a member with privileged roles.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Invited teammate' })).toBeVisible();
    expect(screen.getAllByText('No roles assigned')).toHaveLength(3);
    expect(screen.getByText('Deactivated')).toBeVisible();
    const inactiveRow = screen.getByRole('heading', { name: 'Inactive Member' }).closest('li');
    expect(inactiveRow).not.toBeNull();
    expect(
      within(inactiveRow!).queryByRole('button', { name: 'Deactivate' }),
    ).not.toBeInTheDocument();
  });

  it('keeps roster actions available after assignment, removal, or deactivation errors', async () => {
    mocks.grantRole.mockRejectedValueOnce('network');
    mocks.revokeRole.mockRejectedValueOnce('network');
    mocks.deactivateMember.mockRejectedValueOnce('network');
    const user = userEvent.setup();
    render(<TeamManagement />);
    const row = await screen
      .findByRole('heading', { name: 'Mina Member' })
      .then((heading) => heading.closest('li'));
    expect(row).not.toBeNull();

    await user.selectOptions(within(row!).getByLabelText('Add role to Mina Member'), 'deal_lead');
    await user.click(within(row!).getByRole('button', { name: 'Add role' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The role could not be assigned.');

    await user.click(
      within(row!).getByRole('button', { name: 'Remove IC Member from Mina Member' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('The role could not be removed.');

    await user.click(within(row!).getByRole('button', { name: 'Deactivate' }));
    await user.click(within(row!).getByRole('button', { name: 'Confirm deactivate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The member could not be deactivated.',
    );
  });
});
