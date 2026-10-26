import { describe, expect, it } from 'vitest';

import type { Rpc } from '../db/rpc';
import { RpcError } from '../db/rpc';
import { sha256Hex } from './crypto';
import { createSessionStore, type StoredTokens } from './session-store';

const secrets = {
  jwtSecret: 'dev-only-jwt-secret-change-me-minimum-32-characters',
  sessionSecret: 'dev-only-session-secret-minimum-32-characters',
};
const tokens: StoredTokens = {
  accessToken: 'access',
  refreshToken: 'refresh-me',
  expiresAt: 1_900_000_000_000,
};

interface Call {
  name: string;
  args: Record<string, unknown>;
  bearer: string;
}

function fakeRpc(handler: (call: Call) => unknown): { rpc: Rpc; calls: Call[] } {
  const calls: Call[] = [];
  const rpc: Rpc = {
    call: (name, args, bearer) => {
      const call = { name, args, bearer };
      calls.push(call);
      return Promise.resolve(handler(call));
    },
  };
  return { rpc, calls };
}

function failing(code: string, message: string) {
  return createSessionStore({
    rpc: { call: () => Promise.reject(new RpcError(code, message, 403)) },
    ...secrets,
  });
}

describe('session store', () => {
  it('creates a session: only the hash and the encrypted tokens leave the process', async () => {
    const { rpc, calls } = fakeRpc(() => 'session-uuid');
    const store = createSessionStore({ rpc, ...secrets });
    const { sessionId } = await store.create('user-1', tokens);

    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [call] = calls;
    expect(call?.name).toBe('session_create');
    expect(call?.args.p_session_hash).toBe(sha256Hex(sessionId));
    expect(JSON.stringify(call?.args)).not.toContain(sessionId);
    expect(JSON.stringify(call?.args)).not.toContain('refresh-me');
    expect(String(call?.args.p_tokens_enc)).toMatch(/^\\x[0-9a-f]+$/);
    expect(call?.bearer.split('.')).toHaveLength(3);
  });

  it('looks a session up by hash and decrypts the tokens', async () => {
    let stored = '';
    const { rpc } = fakeRpc(({ name, args }) => {
      if (name === 'session_create') {
        stored = String(args.p_tokens_enc);
        return 'id';
      }
      return [{ user_id: 'user-1', tokens_enc: stored, active_tenant_id: 'tenant-1' }];
    });
    const store = createSessionStore({ rpc, ...secrets });
    const { sessionId } = await store.create('user-1', tokens);
    await expect(store.lookup(sessionId)).resolves.toEqual({
      userId: 'user-1',
      tokens,
      activeTenantId: 'tenant-1',
    });
  });

  it('treats no row, a tampered blob and a bad format as signed out', async () => {
    const empty = createSessionStore({ rpc: fakeRpc(() => []).rpc, ...secrets });
    await expect(empty.lookup('x'.repeat(43))).resolves.toBeNull();

    const tampered = createSessionStore({
      rpc: fakeRpc(() => [
        { user_id: 'u', tokens_enc: `\\x01${'00'.repeat(40)}`, active_tenant_id: null },
      ]).rpc,
      ...secrets,
    });
    await expect(tampered.lookup('x'.repeat(43))).resolves.toBeNull();

    const notAToken = createSessionStore({ rpc: fakeRpc(() => []).rpc, ...secrets });
    await expect(notAToken.lookup('short')).resolves.toBeNull();
  });

  it('does not decrypt tokens written under another secret', async () => {
    let stored = '';
    const { rpc } = fakeRpc(({ name, args }) => {
      if (name === 'session_create') {
        stored = String(args.p_tokens_enc);
        return 'id';
      }
      return [{ user_id: 'u', tokens_enc: stored, active_tenant_id: null }];
    });
    const writer = createSessionStore({ rpc, ...secrets });
    const { sessionId } = await writer.create('u', tokens);
    const reader = createSessionStore({
      rpc,
      ...secrets,
      sessionSecret: 'another-secret-another-secret-12345',
    });
    await expect(reader.lookup(sessionId)).resolves.toBeNull();
  });

  it('forwards token updates, tenant changes and revocation by hash', async () => {
    const { rpc, calls } = fakeRpc(() => undefined);
    const store = createSessionStore({ rpc, ...secrets });
    const id = 'A'.repeat(43);
    await store.updateTokens(id, tokens);
    await store.setTenant(id, 'tenant-9');
    await store.revoke(id);
    expect(calls.map((c) => c.name)).toEqual([
      'session_update_tokens',
      'session_set_tenant',
      'session_revoke',
    ]);
    for (const call of calls) {
      expect(call.args.p_session_hash).toBe(sha256Hex(id));
    }
    expect(calls[1]?.args.p_tenant).toBe('tenant-9');
  });

  it('revokes every session of a user and reports how many', async () => {
    const { rpc, calls } = fakeRpc(() => 3);
    const store = createSessionStore({ rpc, ...secrets });
    await expect(store.revokeUser('user-1')).resolves.toBe(3);
    expect(calls[0]).toMatchObject({ name: 'session_revoke_user', args: { p_user: 'user-1' } });
  });

  it('turns "no active session" and "not a member" into typed outcomes, and passes other errors on', async () => {
    await expect(
      failing('42501', 'no active session').updateTokens('A'.repeat(43), tokens),
    ).resolves.toBe(false);
    await expect(failing('42501', 'not a member').setTenant('A'.repeat(43), 't')).resolves.toBe(
      false,
    );
    await expect(
      failing('unavailable', 'database unavailable').revoke('A'.repeat(43)),
    ).rejects.toBeInstanceOf(RpcError);
  });
});
