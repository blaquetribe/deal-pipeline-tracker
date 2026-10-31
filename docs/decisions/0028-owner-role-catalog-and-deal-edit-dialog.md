# ADR 0028: Owner role catalog and focused deal editing

**Status:** accepted and implemented
**Date:** 2026-10-31

## Context

The roles screen exposed the full tenant role catalog to ordinary team members, although only Owners can manage role definitions. Team invitation and role-assignment forms still need readable choices, but do not need permission definitions. Separately, the Pipeline placed a complete deal-edit form inside each table row. That expanded the row across the page and made editing difficult to scan and use.

## Decision

- Only callers with `role.manage` may read the full role catalog and its permission descriptions. PostgreSQL enforces this in the catalog function; the API route and navigation also gate the screen.
- Team managers receive a separate, tenant-scoped response containing only the role identifiers and display names needed for their management actions. The database omits Owner, Admin, and any role with privileged management permissions for callers without `role.manage`; permission definitions are never included in this response.
- Edit deal opens a native modal dialog with fields in a responsive two-column form and persistent Cancel/Save actions. It keeps the existing version check, exact money parsing, and API update contract.

## Why

Role permissions are security administration data, not useful workspace context for every user. The limited role-choice response preserves invitation and team workflows without disclosing the permission catalog. A modal gives the form room to breathe while keeping the pipeline row compact and the selected deal clear.

## Verification

Route and component tests cover role access metadata, assignable role response, non-owner visibility, and dialog edit behavior. pgTAP verifies database authorization and role filtering. The full Vitest and pgTAP suites pass; typecheck, lint, stylelint, formatting, and the rebuilt Compose app pass. The Owner reviewed the dialog and Team page in light mode without changing records. Refreshed screenshot evidence is still pending.
