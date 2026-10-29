import {
  invitationAcceptBodySchema,
  invitationPreviewBodySchema,
  invitationRegistrationBodySchema,
  inviteMemberBodySchema,
  loginBodySchema,
  defaultsBodySchema,
  organisationBodySchema,
  onboardingStepSchema,
  profileBodySchema,
  resendBodySchema,
  resetBodySchema,
  resetRequestBodySchema,
  revokeInvitationBodySchema,
  signupBodySchema,
  tenantSelectionBodySchema,
  verifyBodySchema,
  type LoginBody,
  type SignupBody,
} from '@dpt/shared';
import { z } from 'zod';

import type { AppEmail } from '../email/templates';
import { HttpError } from '../http/errors';
import {
  noBody,
  publicRoute,
  sessionRoute,
  type HttpDeps,
  type Route,
  type SessionResolver,
} from '../http/route';
import { deriveKey, hmacHex, randomToken, sha256Hex } from './crypto';
import type { GoTrue } from './gotrue';
import type { SessionStore, StoredTokens } from './session-store';

const accountRowsSchema = z.array(z.object({ user_id: z.uuid(), email_verified: z.boolean() }));
const invitationPreviewRowsSchema = z.array(
  z.object({
    tenant_name: z.string(),
    inviter_email: z.email(),
    role_name: z.string(),
    email: z.email(),
  }),
);
const onboardingRowsSchema = z.array(
  z.object({
    flow: z.enum(['owner', 'invitee']),
    current_step: onboardingStepSchema,
    completed: z.boolean(),
    skipped: z.array(onboardingStepSchema),
  }),
);
const tenantChoiceRowsSchema = z.array(z.object({ tenant_id: z.uuid(), tenant_name: z.string() }));
const pendingInvitationRowsSchema = z.array(
  z.object({
    invitation_id: z.uuid(),
    invite_email: z.email(),
    role_key: z.string(),
    created_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }),
  }),
);

export interface AuthMailer {
  send(input: { readonly to: string } & AppEmail): Promise<void>;
}

export interface AuthServiceOptions {
  readonly rpc: { call(name: string, args: Record<string, unknown>): Promise<unknown> };
  readonly userRpc: {
    call(name: string, args: Record<string, unknown>, bearer: string): Promise<unknown>;
  };
  readonly gotrue: GoTrue;
  readonly sessions: SessionStore;
  readonly mailer: AuthMailer;
  readonly sessionSecret: string;
  readonly appOrigin: string;
  readonly now?: () => number;
}

const genericAuthReply = {
  accepted: true,
  message: 'If the details are eligible, instructions will be sent shortly.',
};

function accountKey(email: string): string {
  return sha256Hex(email);
}

function accountRate(name: string) {
  return {
    name,
    limit: 5,
    windowSeconds: 15 * 60,
    keys: ({ clientIp, body }: { clientIp: string; body: { email: string } }) => [
      `ip:${clientIp}`,
      `account:${accountKey(body.email)}`,
    ],
  };
}

export function createSessionResolver({
  sessions,
  gotrue,
  sessionSecret,
  now = Date.now,
}: Pick<AuthServiceOptions, 'sessions' | 'gotrue' | 'sessionSecret' | 'now'>): SessionResolver {
  const csrfKey = deriveKey(sessionSecret, 'csrf');
  const refreshes = new Map<string, Promise<StoredTokens | null>>();
  const refreshLeaseMs = 20_000;

  const isFresh = (tokens: StoredTokens): boolean => tokens.expiresAt > now() + 30_000;

  async function waitForConcurrentRefresh(
    sessionId: string,
    attemptsRemaining = 50,
  ): Promise<StoredTokens | null> {
    if (attemptsRemaining <= 0) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const latest = await sessions.lookup(sessionId);
    if (!latest) return null;
    if (isFresh(latest.tokens)) return latest.tokens;
    return waitForConcurrentRefresh(sessionId, attemptsRemaining - 1);
  }

  async function refreshOnce(sessionId: string): Promise<StoredTokens | null> {
    const running = refreshes.get(sessionId);
    if (running) {
      return running;
    }
    const pending = (async () => {
      const claim = await sessions.claimRefresh(sessionId, refreshLeaseMs);
      if (!claim) return null;
      if (!claim.claimed) {
        return isFresh(claim.tokens) ? claim.tokens : waitForConcurrentRefresh(sessionId);
      }

      try {
        if (isFresh(claim.tokens)) return claim.tokens;
        const refreshed = await gotrue.refresh(claim.tokens.refreshToken);
        if (!refreshed) {
          await sessions.revoke(sessionId);
          return null;
        }
        const updated = await sessions.completeRefresh(sessionId, claim.claimId, refreshed.tokens);
        return updated ? refreshed.tokens : waitForConcurrentRefresh(sessionId);
      } finally {
        await sessions.releaseRefresh(sessionId, claim.claimId);
      }
    })();
    refreshes.set(sessionId, pending);
    try {
      return await pending;
    } finally {
      refreshes.delete(sessionId);
    }
  }

  return {
    async resolve(sessionId) {
      let record = await sessions.lookup(sessionId);
      if (!record) {
        return null;
      }
      if (record.tokens.expiresAt <= now() + 30_000) {
        const tokens = await refreshOnce(sessionId);
        if (!tokens) {
          return null;
        }
        record = { ...record, tokens };
      }
      return {
        sessionId,
        userId: record.userId,
        tenantId: record.activeTenantId,
        accessToken: record.tokens.accessToken,
        csrfToken: hmacHex(csrfKey, sessionId),
      };
    },
  };
}

export function createAuthRoutes(options: AuthServiceOptions): Route[] {
  const { rpc, userRpc, gotrue, sessions, mailer, appOrigin } = options;
  const csrfKey = deriveKey(options.sessionSecret, 'csrf');
  const accountLookup = async (email: string) =>
    accountRowsSchema.parse(await rpc.call('account_lookup', { p_email: email }))[0];
  const issueToken = async (purpose: 'verify_email' | 'reset_password', userId: string) => {
    const token = randomToken();
    await rpc.call('token_issue', {
      p_purpose: purpose,
      p_user: userId,
      p_token_hash: sha256Hex(token),
    });
    return token;
  };
  const consumeToken = (purpose: 'verify_email' | 'reset_password', token: string) =>
    rpc.call('token_consume', { p_purpose: purpose, p_token_hash: sha256Hex(token) });
  const invitationPreview = async (token: string) => {
    const rows = invitationPreviewRowsSchema.parse(
      await rpc.call('invitation_preview', { p_token_hash: sha256Hex(token) }),
    );
    if (!rows[0]) throw new Error('Invitation preview returned no invitation');
    return rows[0];
  };
  const onboardingState = async (accessToken: string) =>
    onboardingRowsSchema.parse(await userRpc.call('onboarding_state', {}, accessToken))[0] ?? null;
  const sendToken = async (
    email: string,
    purpose: 'verify_email' | 'reset_password',
    token: string,
  ) => {
    const path = purpose === 'verify_email' ? '/verify-email' : '/reset-password';
    const link = new URL(path, appOrigin);
    link.searchParams.set('token', token);
    await mailer.send({ to: email, kind: purpose, link: link.toString() });
  };
  const signup = publicRoute<SignupBody>({
    method: 'POST',
    path: '/auth/signup',
    body: signupBodySchema,
    rateLimit: accountRate('signup'),
    handler: async ({ body }) => {
      const created = await gotrue.createUser(body);
      if (created !== 'exists') {
        const token = await issueToken('verify_email', created.userId);
        await sendToken(body.email, 'verify_email', token);
      }
      return { status: 202, body: genericAuthReply };
    },
  });

  const verify = publicRoute({
    method: 'POST',
    path: '/auth/verify',
    body: verifyBodySchema,
    rateLimit: {
      name: 'verify_email',
      limit: 10,
      windowSeconds: 15 * 60,
      keys: ({ clientIp }) => [`ip:${clientIp}`],
    },
    handler: async ({ body }) => {
      await consumeToken('verify_email', body.token);
      return { body: { verified: true } };
    },
  });

  const resend = publicRoute({
    method: 'POST',
    path: '/auth/resend',
    body: resendBodySchema,
    rateLimit: accountRate('resend_verification'),
    handler: async ({ body }) => {
      const account = await accountLookup(body.email);
      if (account && !account.email_verified) {
        const token = await issueToken('verify_email', account.user_id);
        await sendToken(body.email, 'verify_email', token);
      }
      return { status: 202, body: genericAuthReply };
    },
  });

  const login = publicRoute<LoginBody>({
    method: 'POST',
    path: '/auth/login',
    body: loginBodySchema,
    rateLimit: accountRate('login'),
    handler: async (ctx) => {
      const authenticated = await gotrue.passwordLogin(ctx.body.email, ctx.body.password);
      if (!authenticated) {
        return {
          status: 401,
          body: {
            error: { code: 'invalid_credentials', message: 'Email or password is incorrect.' },
          },
        };
      }
      const { sessionId } = await sessions.create(authenticated.userId, authenticated.tokens);
      ctx.setSessionCookie(sessionId);
      return {
        body: {
          user: {
            id: authenticated.userId,
            email: authenticated.tokens.email,
            fullName: authenticated.tokens.fullName,
          },
          csrfToken: hmacHex(csrfKey, sessionId),
        },
      };
    },
  });

  const readSession = sessionRoute({
    method: 'GET',
    path: '/auth/session',
    body: noBody,
    handler: async ({ session }) => {
      const record = await sessions.lookup(session.sessionId);
      if (!record) {
        return {
          status: 401,
          body: { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
        };
      }
      return {
        body: {
          user: { id: record.userId, email: record.tokens.email, fullName: record.tokens.fullName },
          tenantId: record.activeTenantId,
          csrfToken: session.csrfToken,
        },
      };
    },
  });

  const switchTenant = sessionRoute({
    method: 'POST',
    path: '/auth/tenant',
    body: tenantSelectionBodySchema,
    handler: async ({ session, body }) => {
      const changed = await sessions.setTenant(session.sessionId, body.tenantId);
      if (!changed) {
        return {
          status: 403,
          body: {
            error: {
              code: 'forbidden',
              message: 'You are not an active member of that organisation.',
            },
          },
        };
      }
      return { body: { tenantId: body.tenantId } };
    },
  });

  const listTenants = sessionRoute({
    method: 'GET',
    path: '/auth/tenants',
    body: noBody,
    handler: async ({ session }) => {
      const tenants = tenantChoiceRowsSchema.parse(
        await userRpc.call('tenant_choices', {}, session.accessToken),
      );
      return {
        body: {
          activeTenantId: session.tenantId,
          tenants: tenants.map(({ tenant_id, tenant_name }) => ({
            tenantId: tenant_id,
            tenantName: tenant_name,
          })),
        },
      };
    },
  });

  const logout = sessionRoute({
    method: 'POST',
    path: '/auth/logout',
    body: noBody,
    handler: async (ctx) => {
      const record = await sessions.lookup(ctx.session.sessionId);
      await sessions.revoke(ctx.session.sessionId);
      ctx.clearSessionCookie();
      if (record) {
        await gotrue.logout(record.tokens.accessToken);
      }
      return { status: 204 };
    },
  });

  const previewInvitation = publicRoute({
    method: 'POST',
    path: '/auth/invitations/preview',
    body: invitationPreviewBodySchema,
    rateLimit: {
      name: 'invitation_preview',
      limit: 10,
      windowSeconds: 15 * 60,
      keys: ({ clientIp }) => [`ip:${clientIp}`],
    },
    handler: async ({ body }) => {
      const preview = await invitationPreview(body.token);
      return {
        body: {
          tenantName: preview.tenant_name,
          inviterEmail: preview.inviter_email,
          roleName: preview.role_name,
          email: preview.email,
          organisationNameIsSelfDeclared: true,
        },
      };
    },
  });

  const acceptInvitation = sessionRoute({
    method: 'POST',
    path: '/auth/invitations/accept',
    body: invitationAcceptBodySchema,
    rateLimit: {
      name: 'invitation_accept',
      limit: 10,
      windowSeconds: 15 * 60,
      keys: ({ clientIp }) => [`ip:${clientIp}`],
    },
    handler: async ({ body, session }) => {
      const tenantId = z.uuid().parse(
        await rpc.call('invitation_accept', {
          p_token_hash: sha256Hex(body.token),
          p_user: session.userId,
        }),
      );
      if (!(await sessions.setTenant(session.sessionId, tenantId))) {
        throw new Error('Accepted invitation could not be selected as active tenant');
      }
      return { body: { accepted: true, tenantId } };
    },
  });

  const registerInvitation = publicRoute({
    method: 'POST',
    path: '/auth/invitations/register',
    body: invitationRegistrationBodySchema,
    rateLimit: {
      name: 'invitation_register',
      limit: 5,
      windowSeconds: 15 * 60,
      keys: ({ clientIp }) => [`ip:${clientIp}`],
    },
    handler: async (ctx) => {
      const preview = await invitationPreview(ctx.body.token);
      const created = await gotrue.createUser({
        email: preview.email,
        password: ctx.body.password,
        fullName: ctx.body.fullName,
      });
      if (created === 'exists') {
        return {
          status: 409,
          body: {
            error: {
              code: 'sign_in_required',
              message: 'Sign in with the invited email to accept this invitation.',
            },
          },
        };
      }
      const tenantId = z.uuid().parse(
        await rpc.call('invitation_accept', {
          p_token_hash: sha256Hex(ctx.body.token),
          p_user: created.userId,
        }),
      );
      const authenticated = await gotrue.passwordLogin(preview.email, ctx.body.password);
      if (!authenticated) {
        return { body: { accepted: true, tenantId, signInRequired: true } };
      }
      const { sessionId } = await sessions.create(authenticated.userId, authenticated.tokens);
      if (
        authenticated.userId !== created.userId ||
        !(await sessions.setTenant(sessionId, tenantId))
      ) {
        await sessions.revoke(sessionId);
        throw new Error('Invitation membership could not be bound to the new session');
      }
      ctx.setSessionCookie(sessionId);
      return {
        body: {
          accepted: true,
          tenantId,
          signInRequired: false,
          csrfToken: hmacHex(csrfKey, sessionId),
        },
      };
    },
  });

  const inviteMember = sessionRoute({
    method: 'POST',
    path: '/onboarding/invitations',
    body: inviteMemberBodySchema,
    rateLimit: {
      name: 'invite_member',
      limit: 20,
      windowSeconds: 60 * 60,
      keys: ({ clientIp, body }) => [`ip:${clientIp}`, `email:${accountKey(body.email)}`],
    },
    handler: async ({ body, session }) => {
      if (!session.tenantId) {
        return {
          status: 409,
          body: { error: { code: 'tenant_required', message: 'Select an organisation first.' } },
        };
      }
      const token = randomToken();
      await userRpc.call(
        'invite_member',
        {
          p_tenant: session.tenantId,
          p_email: body.email,
          p_role_key: body.roleKey,
          p_token_hash: sha256Hex(token),
        },
        session.accessToken,
      );
      const invite = await invitationPreview(token);
      const link = new URL('/accept-invitation', appOrigin);
      link.searchParams.set('token', token);
      await mailer.send({
        to: invite.email,
        kind: 'invitation',
        link: link.toString(),
        tenantName: invite.tenant_name,
        inviterEmail: invite.inviter_email,
        roleName: invite.role_name,
      });
      return { status: 201, body: { sent: true } };
    },
  });

  const revokeInvitation = sessionRoute({
    method: 'DELETE',
    path: '/onboarding/invitations',
    body: revokeInvitationBodySchema,
    handler: async ({ body, session }) => {
      await userRpc.call(
        'revoke_invitation',
        { p_invitation: body.invitationId },
        session.accessToken,
      );
      return { status: 204 };
    },
  });

  const listInvitations = sessionRoute({
    method: 'GET',
    path: '/onboarding/invitations',
    body: noBody,
    handler: async ({ session }) => {
      if (!session.tenantId) return { body: { invitations: [] } };
      const rows = pendingInvitationRowsSchema.parse(
        await userRpc.call(
          'pending_invitations',
          { p_tenant: session.tenantId },
          session.accessToken,
        ),
      );
      return {
        body: {
          invitations: rows.map((row) => ({
            invitationId: row.invitation_id,
            email: row.invite_email,
            roleKey: row.role_key,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          })),
        },
      };
    },
  });

  const readOnboarding = sessionRoute({
    method: 'GET',
    path: '/onboarding/state',
    body: noBody,
    handler: async ({ session }) => ({
      body: { onboarding: await onboardingState(session.accessToken) },
    }),
  });

  const updateProfile = sessionRoute({
    method: 'PUT',
    path: '/onboarding/profile',
    body: profileBodySchema,
    handler: async ({ body, session }) => {
      await userRpc.call(
        'profile_upsert',
        { p_display_name: body.displayName, p_job_title: body.jobTitle ?? null },
        session.accessToken,
      );
      const state = await onboardingState(session.accessToken);
      const nextStep =
        state?.current_step === 'profile'
          ? await userRpc.call('onboarding_advance', { p_step: 'profile' }, session.accessToken)
          : (state?.current_step ?? null);
      return { body: { saved: true, nextStep } };
    },
  });

  const createOrganisation = sessionRoute({
    method: 'POST',
    path: '/onboarding/organisation',
    body: organisationBodySchema,
    handler: async ({ body, session }) => {
      const tenantId = z
        .uuid()
        .parse(
          await userRpc.call(
            'create_organisation',
            { p_name: body.name, p_timezone: body.timezone, p_currency: body.currency },
            session.accessToken,
          ),
        );
      if (!(await sessions.setTenant(session.sessionId, tenantId))) {
        throw new Error('Created organisation could not be selected as active tenant');
      }
      return { status: 201, body: { tenantId, nextStep: 'defaults' } };
    },
  });

  const updateDefaults = sessionRoute({
    method: 'PUT',
    path: '/onboarding/defaults',
    body: defaultsBodySchema,
    handler: async ({ body, session }) => {
      if (!session.tenantId) {
        throw new HttpError(409, 'tenant_required', 'Create or select an organisation first.');
      }
      await userRpc.call(
        'update_tenant_settings',
        {
          p_tenant: session.tenantId,
          p_timezone: body.timezone,
          p_currency: body.currency,
          p_closing_soon_days: body.closingSoonDays,
        },
        session.accessToken,
      );
      const state = await onboardingState(session.accessToken);
      const nextStep =
        state?.current_step === 'defaults'
          ? await userRpc.call('onboarding_advance', { p_step: 'defaults' }, session.accessToken)
          : (state?.current_step ?? null);
      return { body: { saved: true, nextStep } };
    },
  });

  const skipOnboardingStep = sessionRoute({
    method: 'POST',
    path: '/onboarding/skip/:step',
    body: noBody,
    handler: async ({ params, session }) => {
      const parsedStep = onboardingStepSchema.safeParse(params.step);
      if (!parsedStep.success) {
        throw new HttpError(400, 'invalid_step', 'Unknown onboarding step.');
      }
      const step = parsedStep.data;
      const nextStep = await userRpc.call('onboarding_skip', { p_step: step }, session.accessToken);
      return { body: { nextStep } };
    },
  });

  const completeOnboarding = sessionRoute({
    method: 'POST',
    path: '/onboarding/complete',
    body: noBody,
    handler: async ({ session }) => {
      const state = await onboardingState(session.accessToken);
      if (!state) throw new HttpError(409, 'onboarding_not_started', 'Onboarding has not started.');
      if (state.completed) return { body: { completed: true } };
      if (state.current_step !== 'invite') {
        throw new HttpError(
          409,
          'onboarding_incomplete',
          'Complete the required onboarding steps first.',
        );
      }
      const nextStep = await userRpc.call(
        'onboarding_advance',
        { p_step: 'invite' },
        session.accessToken,
      );
      return { body: { completed: nextStep === 'done' } };
    },
  });

  const requestReset = publicRoute({
    method: 'POST',
    path: '/auth/password-reset',
    body: resetRequestBodySchema,
    rateLimit: accountRate('password_reset'),
    handler: async ({ body }) => {
      const account = await accountLookup(body.email);
      if (account?.email_verified) {
        const token = await issueToken('reset_password', account.user_id);
        await sendToken(body.email, 'reset_password', token);
      }
      return { status: 202, body: genericAuthReply };
    },
  });

  const resetPassword = publicRoute({
    method: 'POST',
    path: '/auth/password-reset/complete',
    body: resetBodySchema,
    rateLimit: {
      name: 'password_reset_complete',
      limit: 10,
      windowSeconds: 15 * 60,
      keys: ({ clientIp }) => [`ip:${clientIp}`],
    },
    handler: async ({ body }) => {
      const userId = await consumeToken('reset_password', body.token);
      const id = z.uuid().parse(userId);
      await gotrue.setPassword(id, body.password);
      await sessions.revokeUser(id);
      return { body: { passwordChanged: true } };
    },
  });

  return [
    signup,
    verify,
    resend,
    login,
    readSession,
    switchTenant,
    listTenants,
    logout,
    previewInvitation,
    acceptInvitation,
    registerInvitation,
    inviteMember,
    listInvitations,
    revokeInvitation,
    readOnboarding,
    updateProfile,
    createOrganisation,
    updateDefaults,
    skipOnboardingStep,
    completeOnboarding,
    requestReset,
    resetPassword,
  ];
}

export function mountAuthRoutes(
  app: Parameters<Route['mount']>[0],
  deps: HttpDeps,
  options: AuthServiceOptions,
): Route[] {
  const routes = createAuthRoutes(options);
  for (const route of routes) {
    route.mount(app, deps);
  }
  return routes;
}
