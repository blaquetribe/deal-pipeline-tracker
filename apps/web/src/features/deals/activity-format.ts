import { isStage, STAGE_LABELS } from '@dpt/shared';

type AssigneeRole = 'owner' | 'lead' | 'member';

type Assignee = {
  role: AssigneeRole;
  user_id: string;
};

const assignmentPrefix = 'Assignees updated: ';
function isAssigneeRole(value: string): value is AssigneeRole {
  return value === 'owner' || value === 'lead' || value === 'member';
}

function parseAssignees(value: string): Assignee[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const assignees: Assignee[] = [];
    for (const item of parsed) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('role' in item) ||
        typeof item.role !== 'string' ||
        !isAssigneeRole(item.role) ||
        !('user_id' in item) ||
        typeof item.user_id !== 'string'
      ) {
        return null;
      }
      assignees.push({ role: item.role, user_id: item.user_id });
    }
    return assignees;
  } catch {
    return null;
  }
}

function describeAssignees(assignees: Assignee[]): string {
  if (assignees.length === 0) return 'no one assigned';

  const counts = new Map<AssigneeRole, number>();
  for (const { role } of assignees) counts.set(role, (counts.get(role) ?? 0) + 1);

  const labels: Record<AssigneeRole, [string, string]> = {
    owner: ['owner', 'owners'],
    lead: ['deal lead', 'deal leads'],
    member: ['team member', 'team members'],
  };

  return (['owner', 'lead', 'member'] as const)
    .flatMap((role) => {
      const count = counts.get(role);
      if (count === undefined) return [];
      const [singular, plural] = labels[role];
      return `${count} ${count === 1 ? singular : plural}`;
    })
    .join(', ')
    .replace(/, ([^,]+)$/, ', and $1');
}

export function formatActivityBody(kind: string, body: string): string {
  if (kind === 'closing_soon_alert') return formatClosingSoonAlert(body);
  if (kind === 'stage_change') return formatStageChange(body);
  if (kind !== 'field_change' || !body.startsWith(assignmentPrefix)) return body;

  const change = body.slice(assignmentPrefix.length);
  const separator = change.indexOf(' -> ');
  if (separator < 0) return 'Deal team assignments changed.';

  const before = parseAssignees(change.slice(0, separator));
  const after = parseAssignees(change.slice(separator + 4));
  if (before === null || after === null) return 'Deal team assignments changed.';

  return `Assigned team changed from ${describeAssignees(before)} to ${describeAssignees(after)}.`;
}

function formatStageChange(body: string): string {
  const match = /^([a-z_]+) -> ([a-z_]+)(?:: (.+))?$/.exec(body);
  if (!match || !isStage(match[1]) || !isStage(match[2])) {
    return 'A stage change was recorded.';
  }

  const [, from, to, reason] = match;
  const transition = `Moved from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}.`;
  if (!reason) return transition;
  if (reason === 'approval quorum reached') {
    return `${transition} The IC approval quorum was met.`;
  }

  return `${transition} Reason: ${reason.replace(/[.\s]+$/, '')}.`;
}

export function formatActivityKind(kind: string): string {
  const labels: Record<string, string> = {
    note: 'Note',
    field_change: 'Deal updated',
    stage_change: 'Stage changed',
    decision: 'Decision',
    approval_decision: 'Approval decision',
    correction: 'Correction',
    closing_soon_alert: 'Closing soon alert',
  };
  return labels[kind] ?? kind.replaceAll('_', ' ');
}

function formatClosingSoonAlert(body: string): string {
  try {
    const payload: unknown = JSON.parse(body);
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('thresholdDays' in payload) ||
      typeof payload.thresholdDays !== 'number' ||
      !Number.isInteger(payload.thresholdDays) ||
      !('closeDate' in payload) ||
      typeof payload.closeDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.closeDate)
    ) {
      return 'A closing soon alert was sent.';
    }

    const date = new Date(`${payload.closeDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return 'A closing soon alert was sent.';
    const closeDate = new Intl.DateTimeFormat('en-ZA', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(date);
    const timing = payload.thresholdDays <= 0 ? 'overdue' : `${payload.thresholdDays}-day reminder`;

    return `Closing alert: ${timing} for an expected close on ${closeDate}.`;
  } catch {
    return 'A closing soon alert was sent.';
  }
}
