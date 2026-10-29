# ADR 0022: tenant-scoped custom role management

Status: accepted
Date: 2026-10-29

## Context

Feature 01 defined immutable tenant system roles, a global permission catalog, conflict pairs, and separation-of-duties triggers. The schema had no user-facing way to create custom roles, so invitation choices were a hardcoded list and direct writes were correctly revoked. Feature 04 needs a safe editor without creating a second authorization path.

## Decision

- Tenant members may read the role catalog through a caller-JWT function that verifies active membership and returns only that tenant's role definitions. It also reports whether the current caller has `role.manage`.
- Users with `role.manage` create or update custom roles through one transactional, security-definer function. The database generates the internal key, validates names and catalog permissions, and replaces the permission set atomically. Roles and role-permission tables remain unwritable directly.
- Existing SoD triggers remain authoritative for conflicts within a role and for conflicts the change would introduce to any member who holds that role. System roles remain immutable. Roles are not deleted, preserving membership assignments and their stable keys.
- Role creation and updates append an audit event containing the stable key, role name, and complete saved permission set. Role changes therefore remain explainable after a later edit.
- The Owner role editor can create and edit custom roles. Invitation forms use the tenant's current catalog, omit the Owner system role, and allow custom roles through the existing invitation function. Existing membership assignment remains through the invitation workflow; a separate team reassignment interface is not included.

## Consequences

Changing permissions affects every current holder immediately. An existing approval request retains its snapshotted approver slots and quorum, while the database checks current permission eligibility when decisions are made. Removing approval access can therefore make a request unreachable; the existing hourly quorum alert is responsible for surfacing that state. No role deletion or bulk member-role editor is added in this slice.

SLA escalation and approval gates beyond IC review remain deferred. The feature walkthrough presentation remains the final project implementation task, after the requested project-wide UI pass.

## Verification

Migration `20261125000000_custom_roles.sql` adds authenticated catalog and save functions, expands the tenant event kinds, and retains direct-write revocations. `supabase/tests/28_custom_roles.test.sql` covers function privileges, tenant isolation, Owner access, non-manager denial, immutable system roles, role- and member-level SoD, atomic updates, and permission snapshots in audit events.
