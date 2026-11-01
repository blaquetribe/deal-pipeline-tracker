'use client';

import { authSessionResponseSchema } from '@dpt/shared';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { subscribeToCloseAccountMenu } from '../shell/account-menu-events';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { sessionRead } from './api';

function initials(name: string | null): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase() ?? '')
      .join('') || '?'
  );
}

export function ProfileAvatar({
  compact = false,
  children,
}: {
  readonly compact?: boolean;
  readonly children?: ReactNode;
}) {
  const inputId = useId();
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{
    id: string;
    email: string;
    fullName: string | null;
    tenantId: string | null;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [hasAvatar, setHasAvatar] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void sessionRead('/auth/session')
      .then((value) => {
        const session = authSessionResponseSchema.parse(value);
        if (active)
          setUser({
            id: session.user.id,
            email: session.user.email,
            fullName: session.user.fullName,
            tenantId: session.tenantId,
          });
        if (active && !session.tenantId)
          setMessage('Choose an organisation before changing your photo.');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => subscribeToCloseAccountMenu(() => setOpen(false)), []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!user?.tenantId) {
      setMessage('Choose an organisation before changing your photo.');
      return;
    }
    setBusy(true);
    setMessage('');
    setPreviewUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
    try {
      const session = authSessionResponseSchema.parse(await sessionRead('/auth/session'));
      const response = await fetch('/api/files/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'X-CSRF-Token': session.csrfToken,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      if (!response.ok) {
        setPreviewUrl(null);
        setMessage(
          response.status === 413
            ? 'Choose an image under 5 MB.'
            : response.status === 415
              ? 'Choose a readable PNG, JPEG, or WebP photo.'
              : response.status === 401
                ? 'Your session ended. Sign in again to update your photo.'
                : 'Your photo could not be saved. Try again.',
        );
        return;
      }
      setVersion((current) => current + 1);
      setHasAvatar(true);
      setPreviewUrl(null);
      setMessage('Profile photo updated.');
    } catch {
      setPreviewUrl(null);
      setMessage('Your profile photo could not be updated. Try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function openOnHover() {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function closeOnLeave() {
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  }

  const avatar = (
    <span
      aria-label={user?.fullName ? `${user.fullName} profile photo` : 'Profile initials'}
      className={`relative grid ${compact ? 'size-9' : 'size-10'} shrink-0 place-items-center overflow-hidden rounded-full bg-brand-soft text-sm font-semibold text-brand-fg`}
    >
      {user && (previewUrl || hasAvatar) ? (
        <Image
          alt=""
          className={`absolute inset-0 ${compact ? 'size-9' : 'size-10'} rounded-full object-cover`}
          height={compact ? 36 : 40}
          key={`${user.id}-${version}`}
          src={previewUrl ?? `/api/users/${user.id}/avatar?v=${version}`}
          unoptimized
          onError={() => {
            if (!previewUrl) setHasAvatar(false);
          }}
          width={compact ? 36 : 40}
        />
      ) : null}
      <span aria-hidden="true">{initials(user?.fullName ?? null)}</span>
    </span>
  );

  return (
    <div
      className="account-menu relative"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={user?.fullName ? `Account menu for ${user.fullName}` : 'Account menu'}
        className="account-menu-trigger"
        onClick={() => setOpen(true)}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') openOnHover();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') closeOnLeave();
        }}
        ref={trigger}
        type="button"
      >
        {avatar}
        <span className="account-menu-trigger-name">{user?.fullName ?? 'Account'}</span>
        <Icon className="size-4 shrink-0 text-fg-muted" name="chevron" />
      </button>
      {open ? (
        <section
          aria-label="Account options"
          className="account-menu-panel"
          id={panelId}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') openOnHover();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') closeOnLeave();
          }}
        >
          <div className="account-menu-identity">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">
                {user?.fullName ?? 'Account'}
              </p>
              <p className="truncate text-xs text-fg-muted">{user?.email ?? 'Signed-in account'}</p>
            </div>
          </div>
          <Button
            aria-describedby={`${inputId}-hint`}
            className="account-menu-item profile-photo-trigger"
            disabled={busy || !user?.tenantId}
            onClick={() => input.current?.click()}
            size="small"
            type="button"
            variant="quiet"
          >
            <Icon className="size-4" name="camera" />
            {busy ? 'Saving photo…' : 'Change photo'}
          </Button>
          <input
            accept="image/png,image/jpeg,image/webp"
            aria-label="Choose profile photo"
            className="sr-only"
            disabled={busy || !user?.tenantId}
            id={inputId}
            onChange={(event) => void upload(event.currentTarget.files?.[0])}
            ref={input}
            tabIndex={-1}
            type="file"
          />
          <span className="sr-only" id={`${inputId}-hint`}>
            PNG, JPEG, or WebP image, smaller than 5 MB.
          </span>
          <p
            aria-live={
              message && /could not|ended|readable|choose an organisation/i.test(message)
                ? 'assertive'
                : 'polite'
            }
            className={message ? 'px-3 py-1 text-xs text-fg-muted' : 'sr-only'}
          >
            {message || (busy ? 'Optimising and saving your photo…' : '')}
          </p>
          {children ? <div className="account-menu-actions">{children}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
