'use client';

import {
  defaultsBodySchema,
  inviteMemberBodySchema,
  ONBOARDING_STEPS,
  organisationBodySchema,
  onboardingStateResponseSchema,
  profileBodySchema,
  tenantRolesCatalogResponseSchema,
  type TenantRole,
  type OnboardingStateResponse,
} from '@dpt/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { PageHeading } from '../shell/page-heading';
import { sessionRead, sessionRequest } from './api';
import { PendingInvitations } from './pending-invitations';
import { SignOutButton } from './sign-out-button';

type OnboardingFlow = NonNullable<OnboardingStateResponse['onboarding']>;
export function onboardingPath(state: OnboardingFlow): string {
  return state.completed || state.current_step === 'done'
    ? '/'
    : `/onboarding/${state.current_step}`;
}

type ValidationProblem = {
  readonly fieldId: string;
  readonly label: string;
  readonly message: string;
};

export function ValidationSummary({
  problems,
}: {
  readonly problems: readonly ValidationProblem[];
}) {
  if (problems.length === 0) return null;

  return (
    <div
      aria-labelledby="onboarding-error-summary-title"
      className="mt-4 rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
      role="alert"
      tabIndex={-1}
    >
      <h3 className="font-semibold" id="onboarding-error-summary-title">
        There is a problem
      </h3>
      <ul className="mt-2 list-disc space-y-1 ps-5">
        {problems.map(({ fieldId, label, message }) => (
          <li key={`${fieldId}-${message}`}>
            <a className="underline" href={`#${fieldId}`}>
              {label}: {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SetupStepper({ state }: { readonly state: OnboardingFlow }) {
  const steps = ONBOARDING_STEPS[state.flow];
  const activeIndex = steps.findIndex(({ step }) => step === state.current_step);
  return (
    <ol aria-label="Setup progress" className="mt-5 grid gap-2 sm:grid-cols-2">
      {steps.map(({ step, label }, index) => {
        const current = step === state.current_step;
        const skipped = state.skipped.includes(step);
        const complete = state.completed || index < activeIndex;
        return (
          <li
            aria-current={current ? 'step' : undefined}
            className={`rounded-control border p-3 ${current ? 'border-brand bg-brand-soft' : 'border-line'}`}
            key={step}
          >
            <span className="font-medium">{label}</span>
            <span className="ms-2 text-sm text-fg-muted">
              {skipped ? 'Skipped' : current ? 'Current step' : complete ? 'Complete' : 'Upcoming'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Onboarding() {
  const pathname = usePathname();
  const router = useRouter();
  const id = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<OnboardingStateResponse['onboarding']>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationProblems, setValidationProblems] = useState<ValidationProblem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [invitationRefreshKey, setInvitationRefreshKey] = useState(0);
  const [roleOptions, setRoleOptions] = useState<TenantRole[]>([]);
  const [roleLoadError, setRoleLoadError] = useState<string | null>(null);
  const rolesLoading =
    step?.current_step === 'invite' && roleOptions.length === 0 && roleLoadError === null;

  const stepKey = step ? `${step.flow}:${step.current_step}:${step.completed}` : '';
  useEffect(() => {
    if (stepKey) stepHeading.current?.focus();
  }, [stepKey]);

  useEffect(() => {
    if (loading) return;
    const expectedPath = step ? onboardingPath(step) : '/';
    if (pathname !== expectedPath) router.replace(expectedPath);
  }, [loading, pathname, router, step]);

  const validationSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (validationProblems.length > 0) {
      validationSummary.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
    }
  }, [validationProblems]);

  async function reload() {
    const result = onboardingStateResponseSchema.parse(await sessionRead('/onboarding/state'));
    setStep(result.onboarding);
  }

  useEffect(() => {
    let active = true;
    void sessionRead('/onboarding/state')
      .then((value) => {
        const result = onboardingStateResponseSchema.parse(value);
        if (active) setStep(result.onboarding);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Setup could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (step?.current_step === 'invite') {
      let active = true;
      void sessionRead('/roles')
        .then((value) => {
          const result = tenantRolesCatalogResponseSchema.parse(value);
          if (active) setRoleOptions(result.roles.filter((role) => role.key !== 'owner'));
        })
        .catch((cause: unknown) => {
          if (active) {
            setRoleOptions([]);
            setRoleLoadError(cause instanceof Error ? cause.message : 'Roles could not be loaded.');
          }
        });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [step?.current_step]);

  async function save(
    event: FormEvent<HTMLFormElement>,
    path: string,
    schema: {
      safeParse(value: unknown):
        | { success: true; data: unknown }
        | {
            success: false;
            error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
          };
    },
    fields: (form: FormData) => unknown,
  ) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const parsed = schema.safeParse(fields(new FormData(event.currentTarget)));
    if (!parsed.success) {
      const form = event.currentTarget;
      setValidationProblems(
        parsed.error.issues.map((issue) => {
          const fieldName = String(issue.path[0] ?? '');
          const control = form.elements.namedItem(fieldName);
          const label =
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement
              ? control.labels?.[0]?.textContent?.replace(/\s*\(optional\)\s*/i, '').trim()
              : undefined;
          return {
            fieldId: control instanceof HTMLElement ? control.id : '',
            label: label || fieldName || 'Form',
            message: issue.message,
          };
        }),
      );
      setError(null);
      return;
    }
    setValidationProblems([]);
    setPending(true);
    try {
      const method = path.endsWith('/profile') || path.endsWith('/defaults') ? 'PUT' : 'POST';
      await sessionRequest(path, method, parsed.data);
      if (path === '/onboarding/invitations') {
        setInvitationRefreshKey((current) => current + 1);
      }
      setMessage(
        path === '/onboarding/organisation'
          ? 'Organisation created.'
          : 'Your changes have been saved.',
      );
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your changes could not be saved.');
    } finally {
      setPending(false);
    }
  }

  async function action(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
    setValidationProblems([]);
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      await sessionRequest(path, method, body);
      await reload();
      setMessage('Your setup has been updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be completed.');
    } finally {
      setPending(false);
    }
  }

  if (loading) return <output aria-busy="true">Loading setup…</output>;

  return (
    <section className="material-card mx-auto max-w-2xl p-6 sm:p-8">
      <PageHeading
        action={<SignOutButton />}
        eyebrow="Deal Pipeline Tracker"
        spacing="compact"
        title="Set up your account"
      />
      {error && (
        <p
          className="mt-4 rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
          role="alert"
        >
          {error}
        </p>
      )}
      <div ref={validationSummary}>
        <ValidationSummary problems={validationProblems} />
      </div>
      {message && <output className="mt-4 text-sm text-success-fg">{message}</output>}
      {!step ? (
        <p className="mt-4">
          No onboarding flow is active.{' '}
          <Link className="text-brand-fg underline" href="/">
            Continue to the pipeline
          </Link>
        </p>
      ) : step.completed || step.current_step === 'done' ? (
        <div className="mt-5 space-y-3">
          <SetupStepper state={step} />
          <h2 className="sr-only" ref={stepHeading} tabIndex={-1}>
            Setup complete
          </h2>
          <p>Your setup is complete.</p>
          <Link
            className="inline-flex rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover"
            href="/"
          >
            Open pipeline
          </Link>
        </div>
      ) : (
        <>
          <SetupStepper state={step} />
          <h2
            className="mt-4 text-lg font-semibold"
            id={`${id}-step-heading`}
            ref={stepHeading}
            tabIndex={-1}
          >
            {ONBOARDING_STEPS[step.flow].find(({ step: key }) => key === step.current_step)
              ?.label ?? 'Account setup'}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {step.flow === 'owner' ? 'Organisation owner' : 'Invited team member'}
          </p>
          {step.current_step === 'profile' && (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) =>
                save(event, '/onboarding/profile', profileBodySchema, (form) => ({
                  displayName: form.get('displayName'),
                  jobTitle: form.get('jobTitle') || null,
                }))
              }
            >
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-profile-display-name`}
                >
                  Display name
                </label>
                <input
                  autoComplete="name"
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  id={`${id}-profile-display-name`}
                  maxLength={100}
                  name="displayName"
                  required
                  type="text"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-profile-job-title`}
                >
                  Job title <span className="text-fg-muted">(optional)</span>
                </label>
                <input
                  autoComplete="organization-title"
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  id={`${id}-profile-job-title`}
                  maxLength={100}
                  name="jobTitle"
                  type="text"
                />
              </div>
              <button
                className="rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover disabled:opacity-60"
                disabled={pending}
                type="submit"
              >
                {pending ? 'Saving…' : 'Save and continue'}
              </button>
            </form>
          )}
          {step.current_step === 'organisation' && (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) =>
                save(event, '/onboarding/organisation', organisationBodySchema, (form) => ({
                  name: form.get('name'),
                  timezone: form.get('timezone') || 'Africa/Johannesburg',
                  currency: form.get('currency') || 'ZAR',
                }))
              }
            >
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-organisation-name`}
                >
                  Organisation name
                </label>
                <input
                  autoComplete="organization"
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  id={`${id}-organisation-name`}
                  maxLength={120}
                  name="name"
                  required
                  type="text"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-organisation-timezone`}
                >
                  Time zone
                </label>
                <input
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  defaultValue="Africa/Johannesburg"
                  id={`${id}-organisation-timezone`}
                  maxLength={100}
                  name="timezone"
                  required
                  type="text"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-organisation-currency`}
                >
                  Default currency
                </label>
                <input
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  defaultValue="ZAR"
                  id={`${id}-organisation-currency`}
                  maxLength={3}
                  name="currency"
                  required
                  type="text"
                />
              </div>
              <button
                className="rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover disabled:opacity-60"
                disabled={pending}
                type="submit"
              >
                {pending ? 'Creating…' : 'Create organisation'}
              </button>
            </form>
          )}
          {step.current_step === 'defaults' && (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) =>
                save(event, '/onboarding/defaults', defaultsBodySchema, (form) => ({
                  timezone: form.get('timezone'),
                  currency: form.get('currency'),
                  closingSoonDays: Number(form.get('closingSoonDays')),
                }))
              }
            >
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-defaults-timezone`}
                >
                  Time zone
                </label>
                <input
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  defaultValue="Africa/Johannesburg"
                  id={`${id}-defaults-timezone`}
                  maxLength={100}
                  name="timezone"
                  required
                  type="text"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-defaults-currency`}
                >
                  Default currency
                </label>
                <input
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  defaultValue="ZAR"
                  id={`${id}-defaults-currency`}
                  maxLength={3}
                  name="currency"
                  required
                  type="text"
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-sm font-medium"
                  htmlFor={`${id}-closing-soon-days`}
                >
                  Closing soon window (days)
                </label>
                <input
                  className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                  defaultValue={60}
                  id={`${id}-closing-soon-days`}
                  max={365}
                  min={1}
                  name="closingSoonDays"
                  required
                  type="number"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover disabled:opacity-60"
                  disabled={pending}
                  type="submit"
                >
                  {pending ? 'Saving…' : 'Save defaults'}
                </button>
                <button
                  className="rounded-control border border-line px-4 py-2 hover:bg-surface-hover disabled:opacity-60"
                  disabled={pending}
                  onClick={() => void action('/onboarding/skip/defaults', 'POST')}
                  type="button"
                >
                  Skip for now
                </button>
              </div>
            </form>
          )}
          {step.current_step === 'invite' && (
            <div className="mt-6 space-y-4">
              <p>Invite teammates now or finish setup and return to this later.</p>
              <p className="text-sm text-fg-muted">
                Need a tailored permission set?{' '}
                <Link className="text-brand-fg underline" href="/roles">
                  Manage organisation roles
                </Link>
                .
              </p>
              {rolesLoading && <output>Loading available roles…</output>}
              {roleLoadError && (
                <p className="text-sm text-danger-fg" role="alert">
                  {roleLoadError}
                </p>
              )}
              <PendingInvitations key={invitationRefreshKey} />
              <form
                className="space-y-4"
                onSubmit={(event) =>
                  save(event, '/onboarding/invitations', inviteMemberBodySchema, (form) => ({
                    email: form.get('email'),
                    roleKey: form.get('roleKey'),
                  }))
                }
              >
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-invite-email`}>
                    Teammate email
                  </label>
                  <input
                    autoComplete="email"
                    className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                    id={`${id}-invite-email`}
                    maxLength={254}
                    name="email"
                    required
                    type="email"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-invite-role`}>
                    Role
                  </label>
                  <select
                    className="w-full rounded-control border border-line bg-surface-raised px-3 py-2 text-fg outline-focus focus-visible:outline-2"
                    disabled={rolesLoading || roleOptions.length === 0}
                    id={`${id}-invite-role`}
                    name="roleKey"
                    required
                  >
                    <option value="">Choose a role</option>
                    {roleOptions.map((role) => (
                      <option key={role.id} value={role.key}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="rounded-control bg-brand px-4 py-2 font-medium text-fg-on-brand hover:bg-brand-hover disabled:opacity-60"
                    disabled={pending}
                    type="submit"
                  >
                    {pending ? 'Sending…' : 'Send invitation'}
                  </button>
                  <button
                    className="rounded-control border border-line px-4 py-2 hover:bg-surface-hover disabled:opacity-60"
                    disabled={pending}
                    onClick={() => void action('/onboarding/complete', 'POST')}
                    type="button"
                  >
                    Finish setup
                  </button>
                  <button
                    className="rounded-control border border-line px-4 py-2 hover:bg-surface-hover disabled:opacity-60"
                    disabled={pending}
                    onClick={() => void action('/onboarding/skip/invite', 'POST')}
                    type="button"
                  >
                    Skip invitations
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
