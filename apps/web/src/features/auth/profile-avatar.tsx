'use client';

import { authSessionResponseSchema } from '@dpt/shared';
import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';

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
  const [user, setUser] = useState<{ id: string; fullName: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [hasAvatar, setHasAvatar] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void sessionRead('/auth/session')
      .then((value) => {
        const session = authSessionResponseSchema.parse(value);
        if (active) setUser({ id: session.user.id, fullName: session.user.fullName });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage('');
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
        setMessage(
          response.status === 413
            ? 'Choose an image under 5 MB.'
            : 'That image could not be uploaded.',
        );
        return;
      }
      setVersion((current) => current + 1);
      setHasAvatar(true);
      setMessage('Profile photo updated.');
    } catch {
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
        {user && hasAvatar ? (
          <Image
            alt=""
            className="absolute inset-0 size-12 rounded-full object-cover"
            height={48}
            key={`${user.id}-${version}`}
            src={`/api/users/${user.id}/avatar?v=${version}`}
            unoptimized
            onError={() => setHasAvatar(false)}
            width={48}
          />
        ) : null}
        <span aria-hidden="true">{initials(user?.fullName ?? null)}</span>
      </div>
      <div>
        <label className="ui-file-trigger" data-disabled={busy ? 'true' : undefined}>
          {busy ? 'Uploading…' : 'Update photo'}
          <input
            accept="image/png,image/jpeg,image/webp"
            className="ui-file-input"
            disabled={busy}
            id={inputId}
            onChange={(event) => void upload(event.currentTarget.files?.[0])}
            ref={input}
            type="file"
          />
        </label>
        <p aria-live="polite" className="text-xs text-fg-muted">
          {message || 'PNG, JPEG, or WebP · max 5 MB'}
        </p>
      </div>
    </div>
  );
}
