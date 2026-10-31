'use client';

import { authSessionResponseSchema } from '@dpt/shared';
import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '../ui/button';
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

export function ProfileAvatar() {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<{
    id: string;
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

  return (
    <div className="flex items-center gap-3">
      <div
        aria-label={user?.fullName ? `${user.fullName} profile photo` : 'Profile initials'}
        className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-soft text-sm font-semibold text-brand-fg"
      >
        {user && (previewUrl || hasAvatar) ? (
          <Image
            alt=""
            className="absolute inset-0 size-12 rounded-full object-cover"
            height={48}
            key={`${user.id}-${version}`}
            src={previewUrl ?? `/api/users/${user.id}/avatar?v=${version}`}
            unoptimized
            onError={() => {
              if (!previewUrl) setHasAvatar(false);
            }}
            width={48}
          />
        ) : null}
        <span aria-hidden="true">{initials(user?.fullName ?? null)}</span>
      </div>
      <div className="min-w-0">
        {user?.fullName ? (
          <p className="max-w-40 truncate text-sm leading-tight font-semibold">{user.fullName}</p>
        ) : null}
        <Button
          aria-describedby={`${inputId}-hint`}
          className="profile-photo-trigger"
          disabled={busy || !user?.tenantId}
          onClick={() => input.current?.click()}
          size="small"
          type="button"
          variant="quiet"
        >
          {busy ? 'Saving…' : 'Change photo'}
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
          className={message ? 'max-w-48 text-xs text-fg-muted' : 'sr-only'}
        >
          {message || (busy ? 'Optimising and saving your photo…' : '')}
        </p>
      </div>
    </div>
  );
}
