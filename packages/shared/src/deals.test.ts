import { describe, expect, it } from 'vitest';

import {
  createDealBodySchema,
  createNoteBodySchema,
  approvalAbsenceBodySchema,
  approvalAbsencesResponseSchema,
  approvalDecisionBodySchema,
  approvalDelegationBodySchema,
  approvalPolicyBodySchema,
  approvalPolicyResponseSchema,
  approvalRequestBodySchema,
  approvalReassignmentBodySchema,
  approvalReassignmentOptionsSchema,
  dealApprovalStatusSchema,
  dashboardSummarySchema,
  dealActivityQuerySchema,
  dealActivityResponseSchema,
  dealListQuerySchema,
  dealListResponseSchema,
  myWorkQuerySchema,
  myWorkResponseSchema,
  setDealAssigneesBodySchema,
  updateDealBodySchema,
} from './deals';

describe('dashboard summary schema', () => {
  it('preserves server clock, tenant calendar and exact currency totals', () => {
    const summary = {
      serverNow: '2026-10-28T10:00:00+00:00',
      nextMidnightAt: '2026-10-28T21:00:00+00:00',
      timeZone: 'Africa/Johannesburg',
      windowDays: 60,
      pipelineByStage: [{ stage: 'sourcing', count: 1 }],
      totalsByCurrency: [{ currency: 'ZAR', amount: '123456789012345' }],
      closingSoonCount: 1,
      closingSoon: [
        {
          id: userA,
          name: 'Northstar',
          stage: 'sourcing',
          amount: '123456789012345',
          currency: 'ZAR',
          expectedCloseDate: '2026-10-29',
          expectedCloseTime: '14:30:00',
          closesInDays: 1,
          closesAt: '2026-10-29T14:30:00+02:00',
        },
      ],
    };
    expect(dashboardSummarySchema.parse(summary).closingSoonCount).toBe(1);
    expect(() =>
      dashboardSummarySchema.parse({
        ...summary,
        totalsByCurrency: [{ currency: 'ZAR', amount: 12.5 }],
      }),
    ).toThrow(/amount/);
  });
});

const userA = 'aaaaaaaa-0000-4000-8000-000000000001';
const userB = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('createDealBodySchema', () => {
  it('normalizes names and defaults the currency without accepting tenant data', () => {
    expect(createDealBodySchema.parse({ name: ' Northstar ' })).toEqual({
      name: 'Northstar',
      currency: 'ZAR',
    });
    expect(() => createDealBodySchema.parse({ name: 'Northstar', tenantId: userA })).toThrow(
      /tenantId/,
    );
  });

  it('accepts integer minor units and rejects floating-point money', () => {
    expect(
      createDealBodySchema.parse({ name: 'Northstar', amount: '123456789012345' }).amount,
    ).toBe('123456789012345');
    expect(() => createDealBodySchema.parse({ name: 'Northstar', amount: 12.5 })).toThrow(/amount/);
    expect(() => createDealBodySchema.parse({ name: 'Northstar', amount: '12.50' })).toThrow(
      /amount/,
    );
  });
});

describe('setDealAssigneesBodySchema', () => {
  it('accepts one owner, one lead and multiple members', () => {
    expect(
      setDealAssigneesBodySchema.parse({
        version: 2,
        assignees: [
          { userId: userA, role: 'owner' },
          { userId: userB, role: 'lead' },
          { userId: 'aaaaaaaa-0000-4000-8000-000000000003', role: 'member' },
        ],
      }).assignees,
    ).toHaveLength(3);
  });

  it('allows an unassigned deal and rejects duplicate users or singleton roles', () => {
    expect(setDealAssigneesBodySchema.parse({ version: 1, assignees: [] }).assignees).toEqual([]);
    expect(() =>
      setDealAssigneesBodySchema.parse({
        version: 1,
        assignees: [
          { userId: userA, role: 'member' },
          { userId: userA, role: 'lead' },
        ],
      }),
    ).toThrow(/one assignment role/);
    expect(() =>
      setDealAssigneesBodySchema.parse({
        version: 1,
        assignees: [
          { userId: userA, role: 'owner' },
          { userId: userB, role: 'owner' },
        ],
      }),
    ).toThrow(/only one owner/);
  });

  it('rejects client-supplied tenant data and oversized lists', () => {
    expect(() =>
      setDealAssigneesBodySchema.parse({
        version: 1,
        assignees: [
          { userId: userA, role: 'member', tenantId: 'aaaaaaaa-0000-4000-8000-000000000001' },
        ],
      }),
    ).toThrow(/tenantId/);
    expect(() =>
      setDealAssigneesBodySchema.parse({
        version: 1,
        assignees: Array.from({ length: 51 }, (_, index) => ({
          userId: `aaaaaaaa-0000-4000-8000-${index.toString().padStart(12, '0')}`,
          role: 'member',
        })),
      }),
    ).toThrow(/Too big|at most 50/);
  });
});

describe('approval absence and reassignment schemas', () => {
  it('accepts bounded timestamp windows and rejects reversed intervals', () => {
    expect(
      approvalAbsenceBodySchema.parse({
        startsAt: '2027-03-01T09:00:00+02:00',
        endsAt: '2027-03-03T17:00:00+02:00',
      }).startsAt,
    ).toBe('2027-03-01T09:00:00+02:00');
    expect(() =>
      approvalAbsenceBodySchema.parse({
        startsAt: '2027-03-03T17:00:00+02:00',
        endsAt: '2027-03-01T09:00:00+02:00',
      }),
    ).toThrow(/end time/);
    expect(() =>
      approvalAbsenceBodySchema.parse({
        startsAt: '2027-03-01T09:00:00',
        endsAt: '2027-03-03T17:00:00',
      }),
    ).toThrow(/startsAt/);
  });

  it('keeps response contracts strict and membership ids server-authored', () => {
    expect(approvalAbsencesResponseSchema.parse([])).toEqual([]);
    expect(() =>
      approvalReassignmentBodySchema.parse({
        fromMembershipId: userA,
        toMembershipId: userB,
        tenantId: 'untrusted',
      }),
    ).toThrow(/tenantId/);
    expect(
      approvalReassignmentOptionsSchema.parse({
        unavailableApprovers: [{ membershipId: userA, displayName: 'Approver' }],
        eligibleReplacements: [{ membershipId: userB, displayName: null }],
      }).eligibleReplacements,
    ).toHaveLength(1);
  });
});

describe('updateDealBodySchema', () => {
  it('requires a current version and at least one permitted change', () => {
    expect(updateDealBodySchema.parse({ expectedVersion: 4, expectedCloseTime: '14:30' })).toEqual({
      expectedVersion: 4,
      expectedCloseTime: '14:30',
    });
    expect(() => updateDealBodySchema.parse({ expectedVersion: 4 })).toThrow(/at least one field/);
    expect(() => updateDealBodySchema.parse({ expectedVersion: null, name: 'Northstar' })).toThrow(
      /expectedVersion/,
    );
  });

  it('accepts exact minor-unit money and explicit clears while rejecting unknown fields', () => {
    expect(
      updateDealBodySchema.parse({ expectedVersion: 1, amount: '12500', sector: null }),
    ).toEqual({ expectedVersion: 1, amount: '12500', sector: null });
    expect(() => updateDealBodySchema.parse({ expectedVersion: 1, amount: 12.5 })).toThrow(
      /amount/,
    );
    expect(() =>
      updateDealBodySchema.parse({ expectedVersion: 1, tenantId: userA, name: 'Northstar' }),
    ).toThrow(/tenantId/);
    expect(() =>
      updateDealBodySchema.parse({ expectedVersion: 1, expectedCloseTime: '25:00' }),
    ).toThrow(/expectedCloseTime/);
  });
});

describe('deal activity schemas', () => {
  it('bounds activity paging and validates opaque bigint cursors as strings', () => {
    expect(dealActivityQuerySchema.parse({ limit: '25', beforeSeq: '9007199254740993' })).toEqual({
      limit: 25,
      beforeSeq: '9007199254740993',
    });
    expect(() => dealActivityQuerySchema.parse({ beforeSeq: '-1' })).toThrow(/beforeSeq/);
    expect(() => dealActivityQuerySchema.parse({ page: 1 })).toThrow(/page/);
  });

  it('rejects blank notes and validates activity attribution and integrity status', () => {
    expect(() => createNoteBodySchema.parse({ body: '   ' })).toThrow(/body/);
    expect(createNoteBodySchema.parse({ body: '  Confidential note  ' })).toEqual({
      body: 'Confidential note',
    });
    expect(() =>
      dealActivityResponseSchema.parse({ events: [], hasMore: false, integrityOk: 'yes' }),
    ).toThrow(/integrityOk/);
  });

  it('accepts system-authored activity events without user attribution', () => {
    const event = {
      seq: '2',
      id: userA,
      kind: 'closing_soon_alert',
      body: '{"closeDate":"2026-11-02","thresholdDays":5,"recipients":[]}',
      actorId: null,
      actorName: 'System',
      actorEmail: 'system',
      createdAt: '2026-10-29T19:00:00+00:00',
      amendsEventId: null,
    };

    expect(
      dealActivityResponseSchema.parse({ events: [event], hasMore: false, integrityOk: true })
        .events[0],
    ).toEqual(event);
  });
});

describe('deal list schemas', () => {
  it('applies bounded defaults and rejects unknown or invalid query values', () => {
    expect(dealListQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(
      dealListQuerySchema.parse({ stage: 'screening', search: '  north  ', limit: '50' }),
    ).toEqual({
      stage: 'screening',
      search: 'north',
      limit: 50,
      offset: 0,
    });
    expect(() => dealListQuerySchema.parse({ stage: 'unknown' })).toThrow(/Invalid option/);
    expect(() => dealListQuerySchema.parse({ tenantId: userA })).toThrow(/tenantId/);
    expect(() => dealListQuerySchema.parse({ limit: '101' })).toThrow(/100/);
  });

  it('validates bounded personal-work paging and exact assigned-deal fields', () => {
    expect(myWorkQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20, offset: 0 });
    expect(() => myWorkQuerySchema.parse({ tenantId: userA })).toThrow(/tenantId/);
    expect(() => myWorkQuerySchema.parse({ offset: '-1' })).toThrow(/offset/);
    expect(
      myWorkResponseSchema.parse({
        total: 1,
        activeCount: 1,
        items: [
          {
            id: userA,
            name: 'Northstar',
            stage: 'due_diligence',
            version: 2,
            sector: 'Technology',
            amount: '12500',
            currency: 'ZAR',
            expected_close_date: '2027-03-31',
            expected_close_time: null,
            created_at: '2026-10-31T10:00:00+00:00',
            assignment_role: 'lead',
          },
        ],
      }).items[0]?.assignment_role,
    ).toBe('lead');
    expect(() => myWorkResponseSchema.parse({ total: 1, activeCount: 1, items: null })).toThrow(
      /items/,
    );
  });

  it('preserves money as integer text and validates close dates and times', () => {
    const response = {
      total: 1,
      items: [
        {
          id: userA,
          name: 'Northstar',
          stage: 'sourcing',
          version: 1,
          sector: 'Technology',
          amount: '123456789012345',
          currency: 'ZAR',
          expected_close_date: '2027-03-31',
          expected_close_time: '15:30:00',
          created_at: '2026-10-28T10:00:00+00:00',
        },
      ],
    };
    expect(dealListResponseSchema.parse(response).items[0]?.amount).toBe('123456789012345');
    expect(() =>
      dealListResponseSchema.parse({
        ...response,
        items: [{ ...response.items[0], expected_close_time: '25:00' }],
      }),
    ).toThrow(/expected_close_time/);
  });
});

describe('approval schemas', () => {
  it('validates strict request, decision and bounded policy inputs', () => {
    expect(
      approvalPolicyResponseSchema.parse({ requiredApprovals: null, delegationEnabled: false }),
    ).toEqual({ requiredApprovals: null, delegationEnabled: false });
    expect(approvalRequestBodySchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(
      approvalDecisionBodySchema.parse({ decision: 'reject', reason: 'Needs review' }),
    ).toEqual({
      decision: 'reject',
      reason: 'Needs review',
    });
    expect(approvalPolicyBodySchema.parse({ requiredApprovals: 2 })).toEqual({
      requiredApprovals: 2,
    });
    expect(
      approvalDecisionBodySchema.parse({ decision: 'approve', onBehalfOfMembershipId: userA }),
    ).toEqual({ decision: 'approve', onBehalfOfMembershipId: userA });
    expect(
      approvalPolicyBodySchema.parse({ requiredApprovals: 2, delegationEnabled: true }),
    ).toEqual({ requiredApprovals: 2, delegationEnabled: true });
    expect(
      approvalDelegationBodySchema.parse({
        delegateMembershipId: userA,
        startsAt: '2027-03-01T09:00:00Z',
        endsAt: '2027-03-02T09:00:00Z',
      }).delegateMembershipId,
    ).toBe(userA);
    expect(() =>
      approvalDelegationBodySchema.parse({
        delegateMembershipId: userA,
        startsAt: '2027-03-02T09:00:00Z',
        endsAt: '2027-03-01T09:00:00Z',
      }),
    ).toThrow(/end time/);
    expect(() => approvalDecisionBodySchema.parse({ decision: 'abstain' })).toThrow(/decision/);
    expect(() => approvalRequestBodySchema.parse({ expectedVersion: 0 })).toThrow(
      /expectedVersion/,
    );
    expect(() => approvalPolicyBodySchema.parse({ requiredApprovals: 51 })).toThrow(
      /requiredApprovals/,
    );
    expect(() => approvalPolicyBodySchema.parse({ requiredApprovals: 2, tenantId: userA })).toThrow(
      /tenantId/,
    );
  });

  it('validates actionable status, nullable policy and quorum fields', () => {
    const status = {
      requestId: null,
      status: null,
      requiredApprovals: null,
      configuredApprovals: null,
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      currentUserDecision: null,
      delegatedSlots: [],
      canRequest: false,
      canDecide: false,
      canConfigure: true,
      canManageAbsence: false,
      canReassign: false,
    };
    expect(dealApprovalStatusSchema.parse(status)).toEqual(status);
    expect(() => dealApprovalStatusSchema.parse({ ...status, tenantId: userA })).toThrow(
      /tenantId/,
    );
  });
});
