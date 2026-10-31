import {
  authSessionResponseSchema,
  assignableRolesResponseSchema,
  memberRoleBodySchema,
  teamMembersResponseSchema,
  type MemberRoleBody,
} from '@dpt/shared';

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function readError(response: Response): Promise<ApiClientError> {
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return new ApiClientError(
    typeof error?.code === 'string' ? error.code : 'request_failed',
    typeof error?.message === 'string'
      ? error.message
      : 'The request could not be completed. Try again.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function authRequest(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readError(response);
  return response.status === 204 ? undefined : response.json();
}

export async function sessionRequest(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<unknown> {
  const sessionResponse = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!sessionResponse.ok) {
    throw new Error('Your session has ended. Sign in again to continue.');
  }
  const session = authSessionResponseSchema.parse(await sessionResponse.json());
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await readError(response);
  return response.status === 204 ? undefined : response.json();
}

export async function sessionRead(path: string): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function readAuthSession() {
  return authSessionResponseSchema.parse(await sessionRead('/auth/session'));
}

export async function readTeamMembers() {
  return teamMembersResponseSchema.parse(await sessionRead('/team/members'));
}

export async function readAssignableRoles() {
  return assignableRolesResponseSchema.parse(await sessionRead('/team/assignable-roles'));
}

export async function grantTeamMemberRole(userId: string, input: MemberRoleBody) {
  const body = memberRoleBodySchema.parse(input);
  await sessionRequest(`/team/members/${encodeURIComponent(userId)}/roles`, 'POST', body);
}

export async function revokeTeamMemberRole(userId: string, input: MemberRoleBody) {
  const body = memberRoleBodySchema.parse(input);
  await sessionRequest(`/team/members/${encodeURIComponent(userId)}/roles`, 'DELETE', body);
}

export async function deactivateTeamMember(userId: string) {
  await sessionRequest(`/team/members/${encodeURIComponent(userId)}`, 'DELETE');
}
