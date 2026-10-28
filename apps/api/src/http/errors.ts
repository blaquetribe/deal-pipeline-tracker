import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { GoTrueError } from '../auth/gotrue';
import { RpcError } from '../db/rpc';

/** An error that is safe to show a client: a status, a stable code and a message we wrote. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const GENERIC = {
  invalid_request: new HttpError(
    422,
    'invalid_request',
    'The request was rejected by a validation rule.',
  ),
  forbidden: new HttpError(403, 'forbidden', 'You are not allowed to do that.'),
  not_found: new HttpError(404, 'not_found', 'Not found.'),
  conflict: new HttpError(409, 'conflict', 'The request conflicts with the current state.'),
  invalid_token: new HttpError(400, 'invalid_token', 'This link is invalid or has expired.'),
  unavailable: new HttpError(503, 'unavailable', 'The service is temporarily unavailable.'),
  internal: new HttpError(500, 'internal', 'Something went wrong.'),
} satisfies Record<string, HttpError>;

/**
 * One place that turns any failure into a response. Messages for our own DP4xx rules are written by
 * us and shown; anything else (SQL, constraint names, stack traces) is replaced by a generic one.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof GoTrueError) {
    if (error.kind === 'weak_password') {
      return new HttpError(
        422,
        'weak_password',
        'That password is not accepted. Choose a longer, less common one.',
      );
    }
    return error.kind === 'unavailable' ? GENERIC['unavailable'] : GENERIC['internal'];
  }
  if (!(error instanceof RpcError)) {
    return GENERIC['internal'];
  }

  switch (error.code) {
    case 'DP401':
      return GENERIC['invalid_token'];
    case 'DP409':
      return new HttpError(
        409,
        'conflict',
        'The record was changed by someone else. Reload and try again.',
      );
    case 'DP422':
      return new HttpError(422, 'rule_violation', error.message);
    case '42501':
      return GENERIC['forbidden'];
    case 'P0002':
      return GENERIC['not_found'];
    case '22023':
    case '23514':
      return GENERIC['invalid_request'];
    case '23505':
    case '55000':
      return GENERIC['conflict'];
    case 'unavailable':
      return GENERIC['unavailable'];
    default:
      return GENERIC['internal'];
  }
}
