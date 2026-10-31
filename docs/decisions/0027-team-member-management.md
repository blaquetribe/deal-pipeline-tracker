# ADR 0027: tenant member management on Team

Status: accepted (owner request, 2026-10-31)

## Context

The Team page let an Owner/Admin invite a person with a role and revoke pending invitations, but it could not show accepted members or update existing access. The owner called out the missing user-management workflow.

## Decision

- The persistent Team page displays active and deactivated tenant memberships with the member's email, display name, and role names.
- The roster is returned by a database function that requires `member.manage`, binds results to the requested tenant, and uses the caller JWT. It is not read through a service-role API client.
- The UI supports adding/removing roles and confirmed member deactivation. It does not allow editing the signed-in administrator's own roles.
- Existing Postgres functions remain the mutation boundary: they enforce active tenant membership, no self-change, role privilege restrictions, SoD triggers, tenant audit events, and last-owner protection. Admins cannot hand out privileged roles; Owner-only capabilities remain database-enforced. When an invitation reactivates a deactivated membership, its prior role grants are cleared atomically before applying only the new invitation role.
- The directory is read-only with respect to profile data; loading it does not write tenant events.

## Consequences

Owners/Admins have a discoverable lifecycle for access: invite, inspect accepted members, adjust permissible roles, deactivate, and review outstanding invitations. Deactivated accounts remain visible for audit context; reactivation continues through a fresh invitation and resets old role grants. pgTAP covers the PII-bearing roster query's caller/tenant boundary and the reactivation reset.
