'use client';

import { useId, useState } from 'react';

import { readDealFiles, uploadDealFile } from './files-api';

interface DealFilesProps {
  readonly dealId: string;
}

function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DealFiles({ dealId }: DealFilesProps) {
  const inputId = useId();
  const [files, setFiles] = useState<Awaited<ReturnType<typeof readDealFiles>>['files']>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  async function refresh() {
    setFiles((await readDealFiles(dealId)).files);
  }

  async function toggle() {
    if (!open) {
      try {
        await refresh();
        setMessage('');
      } catch {
        setMessage('Attachments could not be loaded.');
      }
    }
    setOpen(!open);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      await uploadDealFile(dealId, file);
      await refresh();
      setMessage('PDF attached to this deal.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The attachment could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="deal-files-title" className="material-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold" id="deal-files-title">
            Attachments
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            PDF files are private and available to this deal’s team.
          </p>
        </div>
        <button
          aria-controls={`${inputId}-content`}
          aria-expanded={open}
          className="rounded-control border border-line px-3 py-2 text-sm font-medium hover:bg-surface"
          onClick={() => void toggle()}
          type="button"
        >
          {open ? 'Hide attachments' : 'View attachments'}
        </button>
      </div>
      {open ? (
        <div id={`${inputId}-content`}>
          {files.length ? (
            <ul className="mt-4 space-y-2">
              {files.map((file) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"
                  key={file.id}
                >
                  <span className="text-sm">PDF attachment · {formatSize(file.byteSize)}</span>
                  <a
                    className="text-sm font-medium text-brand underline-offset-2 hover:underline"
                    download
                    href={`/api/files/${file.id}`}
                  >
                    Download PDF
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-fg-muted">No attachments yet.</p>
          )}
          <div className="mt-4">
            <label
              className="cursor-pointer rounded-control border border-line px-3 py-2 text-sm font-medium hover:bg-surface"
              htmlFor={inputId}
            >
              {busy ? 'Uploading…' : 'Add PDF'}
            </label>
            <input
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={busy}
              id={inputId}
              onChange={(event) => void upload(event.currentTarget.files?.[0])}
              type="file"
            />
          </div>
          <p aria-live="polite" className="mt-2 text-sm text-fg-muted">
            {message || 'PDF · max 20 MB'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
