'use client';

import type { ClosingAlertSettings } from '@dpt/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SelectControl } from '../ui/select-control';
import { readClosingAlertSettings, updateClosingAlertSettings } from './api';

const defaults: ClosingAlertSettings = {
  alertDays: [5, 1],
  alertOnOverdue: true,
  extraRecipients: 'none',
};
type ThresholdDraft = { readonly id: number; readonly days: number | '' };
type SettingsDraft = Omit<ClosingAlertSettings, 'alertDays'> & { alertDays: ThresholdDraft[] };

export function ClosingAlertSettingsForm() {
  const id = useId();
  const nextThresholdId = useRef(2);
  const [settings, setSettings] = useState<SettingsDraft>(() => ({
    ...defaults,
    alertDays: defaults.alertDays.map((days, rowId) => ({ id: rowId, days })),
  }));
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readClosingAlertSettings()
      .then((value) => {
        if (active)
          setSettings({
            ...value,
            alertDays: value.alertDays.map((days) => ({ id: nextThresholdId.current++, days })),
          });
        if (active) setLoadFailed(false);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Settings could not be loaded.');
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const days = settings.alertDays.map(({ days: value }) => Number(value));
    if (
      settings.alertDays.some(({ days: value }) => value === '') ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 365)
    ) {
      setError('Each alert threshold must be a whole number from 1 to 365 days.');
      return;
    }
    if (new Set(days).size !== days.length) {
      setError('Each alert threshold must be unique.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next: ClosingAlertSettings = {
        ...settings,
        alertDays: [...days].toSorted((a, b) => b - a),
      };
      await updateClosingAlertSettings(next);
      setMessage('Closing alert settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <output aria-busy="true">Loading closing alert settings…</output>;
  if (loadFailed) {
    return (
      <p
        className="max-w-3xl rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
        role="alert"
      >
        {error} No settings were changed. Ask an Owner or Admin to review access, then reload this
        page.
      </p>
    );
  }

  return (
    <form className="max-w-3xl space-y-6" onSubmit={(event) => void save(event)}>
      {error ? (
        <p
          className="rounded-control border border-danger/40 bg-danger-soft p-3 text-sm text-danger-fg"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? <output className="text-sm text-success-fg">{message}</output> : null}

      <section className="material-card space-y-5 p-5" aria-labelledby={`${id}-thresholds-heading`}>
        <div>
          <h2 className="text-lg font-semibold" id={`${id}-thresholds-heading`}>
            Pre-close reminders
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Choose how many days before a deal’s expected close date to send a reminder. A reminder
            is sent once for each threshold.
          </p>
        </div>
        <ul className="space-y-3" aria-label="Alert thresholds">
          {settings.alertDays.map(({ id: thresholdId, days }, index) => (
            <li className="flex max-w-md items-end gap-3" key={thresholdId}>
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-day-${index}`}>
                  Remind before closing
                </label>
                <Input
                  className="w-full"
                  id={`${id}-day-${index}`}
                  min={1}
                  max={365}
                  type="number"
                  value={days}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      alertDays: current.alertDays.map((item) =>
                        item.id === thresholdId
                          ? {
                              ...item,
                              days: event.target.value === '' ? '' : event.target.valueAsNumber,
                            }
                          : item,
                      ),
                    }))
                  }
                  aria-label={`Reminder threshold ${index + 1}, days before closing`}
                />
              </div>
              <span className="pb-2 text-sm text-fg-muted">days</span>
              <Button
                aria-label={`Remove reminder ${index + 1} (${days} days)`}
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    alertDays: current.alertDays.filter((item) => item.id !== thresholdId),
                  }))
                }
                type="button"
                variant="secondary"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <Button
          disabled={settings.alertDays.length >= 10}
          onClick={() => {
            const thresholdId = nextThresholdId.current++;
            setSettings((current) => {
              const usedDays = new Set(current.alertDays.map((threshold) => threshold.days));
              let days = 1;
              while (usedDays.has(days)) days += 1;
              return { ...current, alertDays: [...current.alertDays, { id: thresholdId, days }] };
            });
          }}
          type="button"
          variant="secondary"
        >
          Add threshold
        </Button>
      </section>

      <section className="material-card space-y-5 p-5" aria-labelledby={`${id}-recipients-heading`}>
        <div>
          <h2 className="text-lg font-semibold" id={`${id}-recipients-heading`}>
            Who receives alerts?
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            The assigned deal team always receives alerts. If no active assignee is available,
            active Owners and Admins receive them instead. Active delegates are included when
            delegation is enabled.
          </p>
        </div>
        <label
          className="flex max-w-xl items-start gap-3 rounded-control border border-line p-3 hover:bg-surface-hover"
          htmlFor={`${id}-overdue`}
        >
          <input
            id={`${id}-overdue`}
            aria-label="Send an alert when a deal becomes overdue"
            checked={settings.alertOnOverdue}
            className="mt-1 accent-brand"
            onChange={(event) =>
              setSettings((current) => ({ ...current, alertOnOverdue: event.target.checked }))
            }
            type="checkbox"
          />
          <span>
            <span className="block font-medium">Send an alert when a deal becomes overdue</span>
            <span className="block text-sm text-fg-muted">
              One alert is sent after the expected close date and time passes.
            </span>
          </span>
        </label>
        <div className="max-w-xl">
          <label className="mb-1 block text-sm font-medium" htmlFor={`${id}-extra`}>
            Additional recipients
          </label>
          <SelectControl
            className="w-full"
            id={`${id}-extra`}
            value={settings.extraRecipients}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                extraRecipients:
                  event.target.value === 'ic' || event.target.value === 'all'
                    ? event.target.value
                    : 'none',
              }))
            }
          >
            <option value="none">Assigned deal team only</option>
            <option value="ic">Also notify active IC members</option>
            <option value="all">Also notify all active organisation members</option>
          </SelectControl>
          <p className="mt-1 text-sm text-fg-muted">
            Additional recipients receive the same in-app and email alert for every threshold.
          </p>
        </div>
      </section>
      <Button disabled={saving} type="submit" variant="primary">
        {saving ? 'Saving…' : 'Save alert settings'}
      </Button>
    </form>
  );
}
