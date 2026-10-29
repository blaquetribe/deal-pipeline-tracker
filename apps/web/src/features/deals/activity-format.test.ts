import { describe, expect, it } from 'vitest';

import { formatActivityBody } from './activity-format';

describe('formatActivityBody', () => {
  it('formats legacy assignee snapshots without exposing user ids', () => {
    const body =
      'Assignees updated: [] -> [{"role": "lead", "user_id": "d0000000-0000-4000-8000-000000000003"}, {"role": "member", "user_id": "d0000000-0000-4000-8000-000000000004"}, {"role": "owner", "user_id": "d0000000-0000-4000-8000-000000000001"}]';

    expect(formatActivityBody('field_change', body)).toBe(
      'Assigned team changed from no one assigned to 1 owner, 1 deal lead, and 1 team member.',
    );
    expect(formatActivityBody('field_change', body)).not.toMatch(/d0000000|user_id|\[\{/);
  });

  it('uses plural labels for multiple assignees in a role', () => {
    const body =
      'Assignees updated: [{"role":"member","user_id":"d0000000-0000-4000-8000-000000000001"}] -> [{"role":"member","user_id":"d0000000-0000-4000-8000-000000000001"},{"role":"member","user_id":"d0000000-0000-4000-8000-000000000002"}]';

    expect(formatActivityBody('field_change', body)).toBe(
      'Assigned team changed from 1 team member to 2 team members.',
    );
  });

  it('hides malformed legacy assignment payloads instead of showing raw JSON', () => {
    expect(formatActivityBody('field_change', 'Assignees updated: [secret ids] -> invalid')).toBe(
      'Deal team assignments changed.',
    );
  });

  it('preserves ordinary activity copy', () => {
    expect(formatActivityBody('field_change', 'Updated: expected close date changed.')).toBe(
      'Updated: expected close date changed.',
    );
    expect(formatActivityBody('note', 'A useful note.')).toBe('A useful note.');
  });
});
