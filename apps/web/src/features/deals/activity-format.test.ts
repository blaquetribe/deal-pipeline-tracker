import { describe, expect, it } from 'vitest';

import { formatActivityBody, formatActivityKind } from './activity-format';

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

  it('formats stage transitions with pipeline labels and a readable approval reason', () => {
    expect(formatActivityBody('stage_change', 'due_diligence -> ic_review')).toBe(
      'Moved from Due Diligence to IC Review.',
    );
    expect(formatActivityBody('stage_change', 'ic_review -> signed: approval quorum reached')).toBe(
      'Moved from IC Review to Signed. The IC approval quorum was met.',
    );
  });

  it('does not expose unknown stage identifiers from malformed events', () => {
    expect(formatActivityBody('stage_change', 'unknown_stage -> ic_review')).toBe(
      'A stage change was recorded.',
    );
  });

  it('uses reader-facing labels for event kinds', () => {
    expect(formatActivityKind('stage_change')).toBe('Stage changed');
    expect(formatActivityKind('field_change')).toBe('Deal updated');
  });

  it('summarizes system closing alerts without exposing JSON recipients', () => {
    const body = '{"closeDate":"2026-11-02","thresholdDays":5,"recipients":["internal-user-id"]}';

    expect(formatActivityBody('closing_soon_alert', body)).toBe(
      'Closing alert: 5-day reminder for an expected close on 02 Nov 2026.',
    );
    expect(formatActivityBody('closing_soon_alert', body)).not.toMatch(
      /recipients|internal-user-id/,
    );
  });

  it('keeps malformed system alert payloads readable', () => {
    expect(formatActivityBody('closing_soon_alert', '{bad json}')).toBe(
      'A closing soon alert was sent.',
    );
  });
});
