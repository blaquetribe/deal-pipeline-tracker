/** Calendar-day distance in the supplied IANA zone; the clock is injectable for parity tests. */
export function daysUntil(date: string, now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export function formatCloseCountdown(
  closesInDays: number,
  closesAt: string | null,
  now: Date,
  timeZone = 'UTC',
): string {
  if (closesInDays > 1) return `${closesInDays} days left`;
  if (closesInDays === 1) {
    if (!closesAt) return 'Closes tomorrow';
    const time = new Intl.DateTimeFormat('en-ZA', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(closesAt));
    return `Closes tomorrow at ${time}`;
  }
  if (closesInDays === 0) {
    if (!closesAt) return 'Closes today';
    const difference = Date.parse(closesAt) - now.getTime();
    const minutes = Math.floor(Math.abs(difference) / 60_000);
    if (difference < 0) return `Overdue by ${formatDuration(minutes)}`;
    return `Closes in ${formatDuration(minutes)}`;
  }
  return `${Math.abs(closesInDays)} ${Math.abs(closesInDays) === 1 ? 'day' : 'days'} overdue`;
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
