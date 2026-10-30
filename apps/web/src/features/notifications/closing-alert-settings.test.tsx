import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClosingAlertSettingsForm } from './closing-alert-settings';

const original = { alertDays: [5, 1], alertOnOverdue: true, extraRecipients: 'none' } as const;
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('ClosingAlertSettingsForm', () => {
  it('loads preferences and saves threshold, overdue, and recipient choices', async () => {
    const user = userEvent.setup();
    const writes: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        const url = urlOf(input);
        if (url === '/api/closing-alert-settings' && init?.method === 'PUT') {
          writes.push(init);
          return response(undefined, 204);
        }
        if (url === '/api/closing-alert-settings') return response(original);
        if (url === '/api/auth/session')
          return response({
            user: {
              id: 'aaaaaaaa-0000-4000-8000-000000000003',
              email: 'owner@example.test',
              fullName: 'Owner',
            },
            tenantId: 'aaaaaaaa-0000-4000-8000-000000000004',
            csrfToken: 'csrf-token',
          });
        return response({}, 404);
      }),
    );
    render(<ClosingAlertSettingsForm />);

    await screen.findByRole('heading', { name: 'Pre-close reminders' });
    await user.clear(
      screen.getByRole('spinbutton', { name: 'Reminder threshold 1, days before closing' }),
    );
    await user.type(
      screen.getByRole('spinbutton', { name: 'Reminder threshold 1, days before closing' }),
      '10',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Additional recipients' }), 'ic');
    await user.click(
      screen.getByRole('checkbox', { name: /Send an alert when a deal becomes overdue/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save alert settings' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Closing alert settings saved.');
    const body = writes[0]?.body;
    expect(typeof body === 'string' ? JSON.parse(body) : null).toEqual({
      alertDays: [10, 1],
      alertOnOverdue: false,
      extraRecipients: 'ic',
    });
  });

  it('validates duplicate thresholds and allows reminders to be disabled', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<FetchMock>(async (input) =>
      urlOf(input) === '/api/closing-alert-settings'
        ? response(original)
        : response({
            user: {
              id: 'aaaaaaaa-0000-4000-8000-000000000003',
              email: 'owner@example.test',
              fullName: 'Owner',
            },
            tenantId: 'aaaaaaaa-0000-4000-8000-000000000004',
            csrfToken: 'csrf-token',
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ClosingAlertSettingsForm />);
    await screen.findByRole('heading', { name: 'Pre-close reminders' });
    const thresholds = screen.getAllByRole('spinbutton');
    await user.clear(thresholds[1]!);
    await user.type(thresholds[1]!, '5');
    await user.click(screen.getByRole('button', { name: 'Save alert settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('must be unique');
    await user.click(screen.getByRole('button', { name: 'Remove reminder 1 (5 days)' }));
    await user.click(screen.getByRole('button', { name: 'Remove reminder 1 (5 days)' }));
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('rejects a blank threshold, adds a reminder, and reports save failures', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<FetchMock>(async (input, init) => {
      if (urlOf(input) === '/api/closing-alert-settings' && init?.method === 'PUT') {
        return response({ error: { message: 'Settings are locked.' } }, 403);
      }
      if (urlOf(input) === '/api/closing-alert-settings') return response(original);
      return response({
        user: {
          id: 'aaaaaaaa-0000-4000-8000-000000000003',
          email: 'owner@example.test',
          fullName: 'Owner',
        },
        tenantId: 'aaaaaaaa-0000-4000-8000-000000000004',
        csrfToken: 'csrf-token',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClosingAlertSettingsForm />);
    await screen.findByRole('heading', { name: 'Pre-close reminders' });
    const threshold = screen.getByRole('spinbutton', {
      name: 'Reminder threshold 1, days before closing',
    });
    await user.clear(threshold);
    await user.click(screen.getByRole('button', { name: 'Save alert settings' }));
    expect(screen.getByRole('alert')).toHaveTextContent('whole number from 1 to 365');

    await user.type(threshold, '10');
    await user.click(screen.getByRole('button', { name: 'Add threshold' }));
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    expect(
      screen.getByRole('spinbutton', { name: 'Reminder threshold 3, days before closing' }),
    ).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'Save alert settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings are locked.');
  });

  it('does not render a writable form when settings cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () => response({ error: { message: 'Permission denied.' } }, 403)),
    );
    render(<ClosingAlertSettingsForm />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No settings were changed.');
    expect(screen.queryByRole('button', { name: 'Save alert settings' })).not.toBeInTheDocument();
  });
});
