import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoleManagement } from './role-management';

const roleId = 'aaaaaaaa-0000-4000-8000-000000000002';
const catalog = {
  canManageRoles: true,
  roles: [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      key: 'owner',
      name: 'Owner',
      isSystem: true,
      permissions: ['deal.view', 'role.manage'],
    },
    {
      id: roleId,
      key: 'custom_abcdefgh',
      name: 'Investment Reviewer',
      isSystem: false,
      permissions: ['deal.view'],
    },
  ],
  permissionCatalog: [
    { key: 'deal.view', description: 'See deals and their ledger' },
    { key: 'approval.decide', description: 'Approve or reject an approval request' },
  ],
};
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionResponse() {
  return jsonResponse({
    user: {
      id: 'aaaaaaaa-0000-4000-8000-000000000003',
      email: 'owner@example.test',
      fullName: 'Owner',
    },
    tenantId: 'aaaaaaaa-0000-4000-8000-000000000004',
    csrfToken: 'csrf-token',
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('RoleManagement', () => {
  it('creates a custom role with selected permissions and keeps system roles read-only', async () => {
    const user = userEvent.setup();
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn<FetchMock>(async (input, init) => {
      const url = requestUrl(input);
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      if (url === '/api/roles' && init?.method === 'POST') return jsonResponse({ roleId });
      if (url === '/api/roles') return jsonResponse(catalog);
      if (url === '/api/auth/session') return sessionResponse();
      return jsonResponse({ error: { code: 'not_found', message: 'Not found.' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleManagement />);

    expect(await screen.findByRole('heading', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Owner' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create custom role' }));
    await user.type(screen.getByRole('textbox', { name: 'Role name' }), 'Committee Observer');
    await user.click(
      screen.getByRole('checkbox', { name: /Approve or reject an approval request/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Create role' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Custom role created.');
    const write = calls.find(({ init }) => init?.method === 'POST');
    const requestBody = write?.init?.body;
    expect(typeof requestBody === 'string' ? JSON.parse(requestBody) : null).toEqual({
      name: 'Committee Observer',
      permissions: ['approval.decide'],
    });
  });

  it('updates an existing custom role through its stable id', async () => {
    const user = userEvent.setup();
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn<FetchMock>(async (input, init) => {
      const url = requestUrl(input);
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      if (url === `/api/roles/${roleId}` && init?.method === 'PUT')
        return jsonResponse(undefined, 204);
      if (url === '/api/roles') return jsonResponse(catalog);
      if (url === '/api/auth/session') return sessionResponse();
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleManagement />);

    await user.click(await screen.findByRole('button', { name: 'Edit Investment Reviewer' }));
    const name = screen.getByRole('textbox', { name: 'Role name' });
    await user.clear(name);
    await user.type(name, 'Senior Investment Reviewer');
    const dealView = screen.getByRole('checkbox', { name: /See deals and their ledger/ });
    await user.click(dealView);
    await user.click(dealView);
    await user.click(screen.getByRole('button', { name: 'Save role' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Role updated.');
    expect(
      calls.some(({ url, init }) => url === `/api/roles/${roleId}` && init?.method === 'PUT'),
    ).toBe(true);
  });

  it('explains invalid permission selections and supports cancelling the form', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () => jsonResponse(catalog)),
    );
    render(<RoleManagement />);

    await user.click(await screen.findByRole('button', { name: 'Create custom role' }));
    await user.type(screen.getByRole('textbox', { name: 'Role name' }), 'No Permissions');
    await user.click(screen.getByRole('button', { name: 'Create role' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Role name' })).not.toBeInTheDocument();
  });

  it('reports a catalog refresh failure after a successful save without claiming success', async () => {
    const user = userEvent.setup();
    let catalogRequests = 0;
    const fetchMock = vi.fn<FetchMock>(async (input, init) => {
      const url = requestUrl(input);
      if (url === '/api/auth/session') return sessionResponse();
      if (url === '/api/roles' && init?.method === 'POST') return jsonResponse({ roleId });
      if (url === '/api/roles') {
        catalogRequests += 1;
        return catalogRequests === 1
          ? jsonResponse(catalog)
          : jsonResponse({ error: { message: 'Role list unavailable.' } }, 503);
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleManagement />);

    await user.click(await screen.findByRole('button', { name: 'Create custom role' }));
    await user.type(screen.getByRole('textbox', { name: 'Role name' }), 'Deal Observer');
    await user.click(screen.getByRole('checkbox', { name: /See deals and their ledger/ }));
    await user.click(screen.getByRole('button', { name: 'Create role' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Role list unavailable.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps role settings out of view for members without role management permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<Response>>(async () =>
        jsonResponse({ ...catalog, canManageRoles: false }),
      ),
    );
    render(<RoleManagement />);

    expect(
      await screen.findByRole('heading', { name: 'Role management is for organisation owners' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create custom role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Roles' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit Investment Reviewer' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces safe catalog and save failures', async () => {
    const user = userEvent.setup();
    let failSave = false;
    const fetchMock = vi.fn<FetchMock>(async (input, init) => {
      const url = requestUrl(input);
      if (url === '/api/roles' && init?.method === 'POST' && failSave) {
        return jsonResponse(
          { error: { code: 'conflict', message: 'Separate approval duties.' } },
          409,
        );
      }
      if (url === '/api/roles') return jsonResponse(catalog);
      if (url === '/api/auth/session') return sessionResponse();
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleManagement />);

    await user.click(await screen.findByRole('button', { name: 'Create custom role' }));
    await user.type(screen.getByRole('textbox', { name: 'Role name' }), 'Conflicting Role');
    await user.click(
      screen.getByRole('checkbox', { name: /Approve or reject an approval request/ }),
    );
    failSave = true;
    await user.click(screen.getByRole('button', { name: 'Create role' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Separate approval duties.');

    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<Response>>(async () =>
        jsonResponse({ error: { message: 'Unavailable.' } }, 503),
      ),
    );
    const { unmount } = render(<RoleManagement />);
    await waitFor(() =>
      expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent('Unavailable.'),
    );
    unmount();
  });
});
