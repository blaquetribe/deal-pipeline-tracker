import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createRateLimiter } from '../http/rate-limit';
import { describeRoutes, type SessionResolver } from '../http/route';
import type { GoTrue } from './gotrue';
import type { AuthMailer, AuthServiceOptions } from './service';
import { createAuthRoutes, createSessionResolver } from './service';
import type { SessionStore, StoredTokens } from './session-store';

const ORIGIN = 'http://localhost:8080';
const secret = 'dev-only-session-secret-minimum-32-characters';
const tokens: StoredTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 1_900_000_000_000,
  email: 'ada@example.test',
  fullName: 'Ada Lovelace',
};

function typedMock<T extends (...args: never[]) => unknown>(implementation: T) {
  return vi.fn<T>(implementation);
}

function harness(
  overrides: Partial<AuthServiceOptions> = {},
  resolver: SessionResolver = { resolve: typedMock(async () => null) },
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const userCalls: { name: string; args: Record<string, unknown>; bearer: string }[] = [];
  const mails: Parameters<AuthMailer['send']>[0][] = [];
  let invitationEmail = 'ada@example.test';
  const rpc = {
    call: typedMock(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'account_lookup') {
        return args.p_email === 'pending@example.test'
          ? [{ user_id: '11111111-1111-4111-8111-111111111111', email_verified: false }]
          : args.p_email === 'ada@example.test'
            ? [{ user_id: '22222222-2222-4222-8222-222222222222', email_verified: true }]
            : [];
      }
      if (name === 'invitation_preview') {
        return [
          {
            tenant_name: 'CVC & Co',
            inviter_email: 'owner@example.test',
            role_name: 'Analyst',
            email: invitationEmail,
          },
        ];
      }
      if (name === 'token_consume') return '22222222-2222-4222-8222-222222222222';
      return '00000000-0000-4000-8000-000000000001';
    }),
  };
  const userRpc = {
    call: typedMock(async (name: string, args: Record<string, unknown>, bearer: string) => {
      userCalls.push({ name, args, bearer });
      if (name === 'onboarding_state') {
        return [{ flow: 'owner', current_step: 'profile', completed: false, skipped: [] }];
      }
      if (name === 'onboarding_advance') return 'organisation';
      if (name === 'tenant_choices')
        return [{ tenant_id: '33333333-3333-4333-8333-333333333333', tenant_name: 'CVC Capital' }];
      if (name === 'pending_invitations')
        return [
          {
            invitation_id: '44444444-4444-4444-8444-444444444444',
            invite_email: 'new@example.test',
            role_key: 'deal_member',
            created_at: '2026-10-28T10:00:00+00:00',
            expires_at: '2026-11-04T10:00:00+00:00',
          },
        ];
      if (name === 'invite_member' && typeof args.p_email === 'string') {
        invitationEmail = args.p_email;
      }
      return '00000000-0000-4000-8000-000000000001';
    }),
  };
  const gotrue = {
    createUser: typedMock(async (): Promise<{ userId: string } | 'exists'> => ({
      userId: '22222222-2222-4222-8222-222222222222',
    })),
    passwordLogin: typedMock(async () => ({
      userId: '22222222-2222-4222-8222-222222222222',
      tokens,
    })),
    refresh: typedMock(async () => ({ userId: '22222222-2222-4222-8222-222222222222', tokens })),
    logout: typedMock(async () => undefined),
    setPassword: typedMock(async () => undefined),
  } satisfies GoTrue;
  const sessions = {
    create: typedMock(async () => ({ sessionId: 'A'.repeat(43) })),
    lookup: typedMock(async () => ({
      userId: '22222222-2222-4222-8222-222222222222',
      tokens,
      activeTenantId: null,
    })),
    updateTokens: typedMock(async () => true),
    setTenant: typedMock(async () => true),
    revoke: typedMock(async () => undefined),
    revokeUser: typedMock(async () => 1),
  } satisfies SessionStore;
  const mailer: AuthMailer = {
    send: typedMock(async (message) => {
      mails.push(message);
    }),
  };
  const app = new Hono();
  const options: AuthServiceOptions = {
    rpc,
    userRpc,
    gotrue,
    sessions,
    mailer,
    sessionSecret: secret,
    appOrigin: ORIGIN,
    ...overrides,
  };
  const routes = createAuthRoutes(options);
  const deps = {
    appOrigin: ORIGIN,
    cookieSecure: false,
    resolver,
    limiter: createRateLimiter(),
    logger: { info: typedMock(() => undefined), error: typedMock(() => undefined) },
  };
  for (const route of routes) route.mount(app, deps);
  return { app, routes, calls, userCalls, mails, rpc, userRpc, gotrue, sessions, mailer, resolver };
}

const post = (body: unknown, cookie?: string, csrf?: string): RequestInit => ({
  method: 'POST',
  headers: {
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
  },
  body: JSON.stringify(body),
});

describe('auth routes', () => {
  it('keeps sign-up generic and mails only for a newly created account', async () => {
    const { app, mails, calls, gotrue } = harness();
    const first = await app.request(
      '/auth/signup',
      post({
        email: 'Ada@example.test',
        password: 'correct-horse',
        fullName: 'Ada Lovelace',
      }),
    );
    expect(first.status).toBe(202);
    const firstReply = await first.json();
    const token = new URL(mails[0]?.link ?? '').searchParams.get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls.find((call) => call.name === 'token_issue')?.args).toMatchObject({
      p_purpose: 'verify_email',
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(calls.find((call) => call.name === 'token_issue')?.args.p_token_hash).not.toBe(token);

    gotrue.createUser.mockResolvedValueOnce('exists');
    const second = await app.request(
      '/auth/signup',
      post({
        email: 'Ada@example.test',
        password: 'correct-horse',
        fullName: 'Ada Lovelace',
      }),
    );
    expect(await second.json()).toEqual(firstReply);
    expect(mails).toHaveLength(1);
  });

  it('returns identical signed-out responses for unknown and known resend/reset emails', async () => {
    const { app, mails, calls } = harness();
    const responses = await Promise.all([
      app.request('/auth/resend', post({ email: 'nobody@example.test' })),
      app.request('/auth/resend', post({ email: 'pending@example.test' })),
      app.request('/auth/password-reset', post({ email: 'nobody@example.test' })),
      app.request('/auth/password-reset', post({ email: 'ada@example.test' })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202, 202, 202]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      {
        accepted: true,
        message: 'If the details are eligible, instructions will be sent shortly.',
      },
      {
        accepted: true,
        message: 'If the details are eligible, instructions will be sent shortly.',
      },
      {
        accepted: true,
        message: 'If the details are eligible, instructions will be sent shortly.',
      },
      {
        accepted: true,
        message: 'If the details are eligible, instructions will be sent shortly.',
      },
    ]);
    expect(mails).toHaveLength(2);
    expect(calls.filter((call) => call.name === 'token_issue')).toHaveLength(2);
  });

  it('creates an opaque cookie and returns the CSRF token, then requires it for logout', async () => {
    const resolver = {
      resolve: typedMock(
        async () =>
          null as null | {
            sessionId: string;
            userId: string;
            tenantId: null;
            accessToken: string;
            csrfToken: string;
          },
      ),
    };
    const { app, sessions, gotrue } = harness({}, resolver);
    const login = await app.request(
      '/auth/login',
      post({ email: 'ada@example.test', password: 'correct-horse' }),
    );
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');
    const loginBody = z
      .object({
        csrfToken: z.string(),
        user: z.object({ id: z.string(), email: z.string() }),
      })
      .parse(await login.json());
    resolver.resolve.mockResolvedValue({
      sessionId: 'A'.repeat(43),
      userId: '22222222-2222-4222-8222-222222222222',
      tenantId: null,
      accessToken: 'access-token',
      csrfToken: loginBody.csrfToken,
    });
    expect(loginBody).toMatchObject({
      user: { id: '22222222-2222-4222-8222-222222222222', email: tokens.email },
      csrfToken: expect.any(String),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const badCsrf = await app.request('/auth/logout', post({}, cookie));
    expect(badCsrf.status).toBe(403);
    const logout = await app.request('/auth/logout', post({}, cookie, loginBody.csrfToken));
    expect(logout.status).toBe(204);
    expect(sessions.create).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', tokens);
    expect(sessions.revoke).toHaveBeenCalledWith('A'.repeat(43));
    expect(gotrue.logout).toHaveBeenCalledWith(tokens.accessToken);
  });

  it('consumes a reset token once before changing the password and revokes existing sessions', async () => {
    const { app, calls, gotrue, sessions } = harness();
    const response = await app.request(
      '/auth/password-reset/complete',
      post({ token: 'T'.repeat(43), password: 'a-new-correct-horse' }),
    );
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.name)).toContain('token_consume');
    expect(gotrue.setPassword).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      'a-new-correct-horse',
    );
    expect(sessions.revokeUser).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });

  it('switches tenants only through the membership-checked session function', async () => {
    const resolver = {
      resolve: typedMock(async () => ({
        sessionId: 'A'.repeat(43),
        userId: '22222222-2222-4222-8222-222222222222',
        tenantId: null,
        accessToken: 'access-token',
        csrfToken: 'csrf',
      })),
    };
    const { app, sessions } = harness({}, resolver);
    const response = await app.request(
      '/auth/tenant',
      post(
        { tenantId: '33333333-3333-4333-8333-333333333333' },
        `dpt_session=${'A'.repeat(43)}`,
        'csrf',
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantId: '33333333-3333-4333-8333-333333333333' });
    expect(sessions.setTenant).toHaveBeenCalledWith(
      'A'.repeat(43),
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('lists tenant choices through the signed-in user JWT and returns the active tenant', async () => {
    const resolver = {
      resolve: typedMock(async () => ({
        sessionId: 'A'.repeat(43),
        userId: '22222222-2222-4222-8222-222222222222',
        tenantId: '33333333-3333-4333-8333-333333333333',
        accessToken: 'user-access',
        csrfToken: 'csrf',
      })),
    };
    const { app, userCalls } = harness({}, resolver);
    const response = await app.request('/auth/tenants', {
      headers: { Cookie: `dpt_session=${'A'.repeat(43)}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      activeTenantId: '33333333-3333-4333-8333-333333333333',
      tenants: [{ tenantId: '33333333-3333-4333-8333-333333333333', tenantName: 'CVC Capital' }],
    });
    expect(userCalls).toContainEqual({
      name: 'tenant_choices',
      args: {},
      bearer: 'user-access',
    });
  });

  it('lists safe pending invitation data for the active tenant through the user JWT', async () => {
    const resolver = {
      resolve: typedMock(async () => ({
        sessionId: 'A'.repeat(43),
        userId: '22222222-2222-4222-8222-222222222222',
        tenantId: '33333333-3333-4333-8333-333333333333',
        accessToken: 'user-access',
        csrfToken: 'csrf',
      })),
    };
    const { app, userCalls } = harness({}, resolver);
    const response = await app.request('/onboarding/invitations', {
      headers: { Cookie: `dpt_session=${'A'.repeat(43)}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      invitations: [
        {
          invitationId: '44444444-4444-4444-8444-444444444444',
          email: 'new@example.test',
          roleKey: 'deal_member',
          createdAt: '2026-10-28T10:00:00+00:00',
          expiresAt: '2026-11-04T10:00:00+00:00',
        },
      ],
    });
    expect(userCalls).toContainEqual({
      name: 'pending_invitations',
      args: { p_tenant: '33333333-3333-4333-8333-333333333333' },
      bearer: 'user-access',
    });
  });

  it('previews an invitation using only the token hash', async () => {
    const { app, calls } = harness();
    const token = 'I'.repeat(43);
    const response = await app.request('/auth/invitations/preview', post({ token }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tenantName: 'CVC & Co',
      inviterEmail: 'owner@example.test',
      roleName: 'Analyst',
      email: 'ada@example.test',
      organisationNameIsSelfDeclared: true,
    });
    expect(calls.find((call) => call.name === 'invitation_preview')?.args).toEqual({
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(calls.find((call) => call.name === 'invitation_preview')?.args.p_token_hash).not.toBe(
      token,
    );
  });

  it('creates a new invited account and binds its session to the accepted tenant', async () => {
    const { app, calls, sessions } = harness();
    const response = await app.request(
      '/auth/invitations/register',
      post({
        token: 'I'.repeat(43),
        password: 'correct-horse',
        fullName: 'Ada Lovelace',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true, signInRequired: false });
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(calls.find((call) => call.name === 'invitation_accept')?.args).toMatchObject({
      p_user: '22222222-2222-4222-8222-222222222222',
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(sessions.setTenant).toHaveBeenCalledWith(
      'A'.repeat(43),
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('sends invitations for the active tenant using the user JWT and refuses client tenant overrides', async () => {
    const resolver = {
      resolve: typedMock(async () => ({
        sessionId: 'A'.repeat(43),
        userId: '22222222-2222-4222-8222-222222222222',
        tenantId: '33333333-3333-4333-8333-333333333333',
        accessToken: 'user-access',
        csrfToken: 'csrf',
      })),
    };
    const { app, userCalls, mails } = harness({}, resolver);
    const response = await app.request(
      '/onboarding/invitations',
      post(
        { email: 'new@example.test', roleKey: 'analyst' },
        `dpt_session=${'A'.repeat(43)}`,
        'csrf',
      ),
    );
    expect(response.status).toBe(201);
    expect(userCalls[0]).toMatchObject({
      name: 'invite_member',
      args: {
        p_tenant: '33333333-3333-4333-8333-333333333333',
        p_email: 'new@example.test',
        p_role_key: 'analyst',
        p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      bearer: 'user-access',
    });
    expect(mails[0]).toMatchObject({
      to: 'new@example.test',
      kind: 'invitation',
      tenantName: 'CVC & Co',
      inviterEmail: 'owner@example.test',
    });
    const spoofed = await app.request(
      '/onboarding/invitations',
      post(
        {
          email: 'new@example.test',
          roleKey: 'analyst',
          tenantId: '44444444-4444-4444-8444-444444444444',
        },
        `dpt_session=${'A'.repeat(43)}`,
        'csrf',
      ),
    );
    expect(spoofed.status).toBe(400);
  });

  it('saves the actor profile before advancing and creates the organisation only through the DB function', async () => {
    const resolver = {
      resolve: typedMock(async () => ({
        sessionId: 'A'.repeat(43),
        userId: '22222222-2222-4222-8222-222222222222',
        tenantId: null,
        accessToken: 'user-access',
        csrfToken: 'csrf',
      })),
    };
    const { app, userCalls, sessions } = harness({}, resolver);
    const cookie = `dpt_session=${'A'.repeat(43)}`;
    const profile = await app.request('/onboarding/profile', {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': 'csrf',
      },
      body: JSON.stringify({ displayName: 'Ada Lovelace', jobTitle: 'Partner' }),
    });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({ saved: true, nextStep: 'organisation' });
    expect(userCalls.slice(0, 3).map((call) => call.name)).toEqual([
      'profile_upsert',
      'onboarding_state',
      'onboarding_advance',
    ]);
    expect(userCalls[0]?.args).toEqual({ p_display_name: 'Ada Lovelace', p_job_title: 'Partner' });

    const organisation = await app.request('/onboarding/organisation', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': 'csrf',
      },
      body: JSON.stringify({ name: 'CVC Capital' }),
    });
    expect(organisation.status).toBe(201);
    expect(userCalls.find((call) => call.name === 'create_organisation')?.args).toEqual({
      p_name: 'CVC Capital',
      p_timezone: 'Africa/Johannesburg',
      p_currency: 'ZAR',
    });
    expect(sessions.setTenant).toHaveBeenCalledWith(
      'A'.repeat(43),
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('declares only the intended auth routes public', () => {
    const { routes } = harness();
    expect(describeRoutes(routes)).toEqual([
      { method: 'POST', path: '/auth/signup', access: 'public' },
      { method: 'POST', path: '/auth/verify', access: 'public' },
      { method: 'POST', path: '/auth/resend', access: 'public' },
      { method: 'POST', path: '/auth/login', access: 'public' },
      { method: 'GET', path: '/auth/session', access: 'session' },
      { method: 'POST', path: '/auth/tenant', access: 'session' },
      { method: 'GET', path: '/auth/tenants', access: 'session' },
      { method: 'POST', path: '/auth/logout', access: 'session' },
      { method: 'POST', path: '/auth/invitations/preview', access: 'public' },
      { method: 'POST', path: '/auth/invitations/accept', access: 'session' },
      { method: 'POST', path: '/auth/invitations/register', access: 'public' },
      { method: 'POST', path: '/onboarding/invitations', access: 'session' },
      { method: 'GET', path: '/onboarding/invitations', access: 'session' },
      { method: 'DELETE', path: '/onboarding/invitations', access: 'session' },
      { method: 'GET', path: '/onboarding/state', access: 'session' },
      { method: 'PUT', path: '/onboarding/profile', access: 'session' },
      { method: 'POST', path: '/onboarding/organisation', access: 'session' },
      { method: 'PUT', path: '/onboarding/defaults', access: 'session' },
      { method: 'POST', path: '/onboarding/skip/:step', access: 'session' },
      { method: 'POST', path: '/onboarding/complete', access: 'session' },
      { method: 'POST', path: '/auth/password-reset', access: 'public' },
      { method: 'POST', path: '/auth/password-reset/complete', access: 'public' },
    ]);
  });
});

describe('session resolver', () => {
  it('shares one refresh across concurrent requests for the same session', async () => {
    let finishRefresh: ((value: { userId: string; tokens: StoredTokens }) => void) | undefined;
    let startRefresh: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startRefresh = resolve;
    });
    const refreshed: StoredTokens = {
      ...tokens,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: 2_000_000_000_000,
    };
    const refresh = typedMock(
      () =>
        new Promise<{ userId: string; tokens: StoredTokens }>((resolve) => {
          finishRefresh = resolve;
          startRefresh?.();
        }),
    );
    const updateTokens = typedMock(async () => true);
    const store: SessionStore = {
      create: typedMock(async () => ({ sessionId: 'A'.repeat(43) })),
      lookup: typedMock(async () => ({
        userId: '22222222-2222-4222-8222-222222222222',
        tokens: { ...tokens, expiresAt: 1 },
        activeTenantId: null,
      })),
      updateTokens,
      setTenant: typedMock(async () => true),
      revoke: typedMock(async () => undefined),
      revokeUser: typedMock(async () => 1),
    };
    const resolver = createSessionResolver({
      sessions: store,
      gotrue: {
        refresh,
        passwordLogin: typedMock(async () => null),
        logout: typedMock(async () => undefined),
        createUser: typedMock(async (): Promise<'exists'> => 'exists'),
        setPassword: typedMock(async () => undefined),
      },
      sessionSecret: secret,
      now: () => 1_800_000_000_000,
    });
    const one = resolver.resolve('A'.repeat(43));
    const two = resolver.resolve('A'.repeat(43));
    await started;
    finishRefresh?.({ userId: '22222222-2222-4222-8222-222222222222', tokens: refreshed });
    const [a, b] = await Promise.all([one, two]);
    expect(a).toEqual(b);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateTokens).toHaveBeenCalledTimes(1);
  });
});
