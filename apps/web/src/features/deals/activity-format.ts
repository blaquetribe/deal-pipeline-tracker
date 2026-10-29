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
  if (kind !== 'field_change' || !body.startsWith(assignmentPrefix)) return body;

  const change = body.slice(assignmentPrefix.length);
  const separator = change.indexOf(' -> ');
  if (separator < 0) return 'Deal team assignments changed.';

  const before = parseAssignees(change.slice(0, separator));
  const after = parseAssignees(change.slice(separator + 4));
  if (before === null || after === null) return 'Deal team assignments changed.';

  return `Assigned team changed from ${describeAssignees(before)} to ${describeAssignees(after)}.`;
}
