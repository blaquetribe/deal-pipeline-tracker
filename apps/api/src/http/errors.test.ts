import { describe, expect, it } from 'vitest';

import { RpcError } from '../db/rpc';
import { HttpError, toHttpError } from './errors';

describe('toHttpError', () => {
  it('passes an HttpError through untouched', () => {
    const error = new HttpError(418, 'teapot', 'short and stout');
    expect(toHttpError(error)).toBe(error);
  });

  it.each([
    ['DP401', 'invalid token', 400, 'invalid_token'],
    ['DP409', 'stale version', 409, 'conflict'],
    ['DP422', 'transition not allowed', 422, 'rule_violation'],
    ['42501', 'permission denied', 403, 'forbidden'],
    ['P0002', 'deal not found', 404, 'not_found'],
    ['22023', 'invalid email', 422, 'invalid_request'],
    ['23514', 'violates check constraint', 422, 'invalid_request'],
    ['23505', 'duplicate key', 409, 'conflict'],
    ['55000', 'deal is archived', 409, 'conflict'],
  ])('maps database error %s to %i %s', (code, message, status, apiCode) => {
    const mapped = toHttpError(new RpcError(code, message, 400));
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(apiCode);
  });

  it('shows our own rule messages (DP4xx) but never raw database text for other errors', () => {
    expect(toHttpError(new RpcError('DP422', 'missing required fields: sector', 400)).message).toBe(
      'missing required fields: sector',
    );
    expect(
      toHttpError(
        new RpcError('23514', 'new row for relation "deals" violates check constraint', 400),
      ).message,
    ).toBe('The request was rejected by a validation rule.');
    expect(
      toHttpError(new RpcError('42501', 'permission denied for table api_sessions', 403)).message,
    ).toBe('You are not allowed to do that.');
  });

  it('reports an unavailable database as 503 and anything unknown as an opaque 500', () => {
    expect(toHttpError(new RpcError('unavailable', 'database unavailable', 503))).toMatchObject({
      status: 503,
      code: 'unavailable',
    });
    const unknown = toHttpError(new Error('connection string postgres://user:pw@host'));
    expect(unknown).toMatchObject({
      status: 500,
      code: 'internal',
      message: 'Something went wrong.',
    });
    expect(toHttpError('a string')).toMatchObject({ status: 500, code: 'internal' });
    expect(toHttpError(new RpcError('upstream', 'unexpected', 502))).toMatchObject({
      status: 500,
      code: 'internal',
    });
  });
});
