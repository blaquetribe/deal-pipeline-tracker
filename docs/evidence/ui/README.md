# UI evidence

## Current system redesign

Screenshots 16–18 were captured on 1 November 2026 from the local Compose application on port 8081, signed in as the fictional Asteron Capital Owner, in the light theme. Navigation was read-only; opening the edit dialog did not submit a change. They show the refreshed board-first Pipeline, focused deal editor, and Owner Team controls. The connected indicator in the shared header was green during capture.

| Screenshot | Screen |
|---|---|
| [16-pipeline-board-redesign.png](16-pipeline-board-redesign.png) | Board-first pipeline, portfolio summary, distinct stage colors, and Passed outcome lane |
| [17-deal-edit-light.png](17-deal-edit-light.png) | Light-theme deal edit dialog opened over Pipeline List; no values changed |
| [18-team-owner-navigation.png](18-team-owner-navigation.png) | Owner-only team management controls and role creation entry point |

The evidence uses fictional seed data and represents the 1 November UI redesign. The 2 November audit/List and approval-routing follow-up was visually reviewed in the isolated app on port 8082, including List sort controls, filters, audit columns, assignment and approval fields. Those captures were visible in the review session but have not been saved as image files in this repository. The responsive layout and mobile navigation were reviewed earlier, but a refreshed mobile screenshot is not included here; screenshots 10 and 15 below are historical and predate the redesign.

Screenshots 16–18 are committed with PR #50. PR #51 merged the List/audit data, selected-approver UI, and realtime invalidation to `main`, but the browser review captures were not saved as image files. Remaining evidence: save screenshots for those screens and capture a refreshed mobile view. Do not cite the browser review as a repository screenshot.

## Historical evidence

Screenshots 01–15 were captured between 30 and 31 October 2026 before the 1 November system redesign. They remain useful for specific earlier workflows, successful uploads, and seed data, but they do not represent the current visual system. Do not use them to judge current typography, navigation, spacing, deal editing, or theme styling.

| Screenshot | Earlier screen or flow |
|---|---|
| [01-deal-board.png](01-deal-board.png), [04-deal-board-current.png](04-deal-board-current.png) | Earlier deal board |
| [02-deal-activity.png](02-deal-activity.png), [05-deal-activity-current.png](05-deal-activity-current.png) | Earlier deal activity |
| [03-deal-pipeline-dashboard.png](03-deal-pipeline-dashboard.png), [14-pipeline-dashboard.png](14-pipeline-dashboard.png) | Earlier Pipeline overview |
| [06-closing-alert-settings.png](06-closing-alert-settings.png) | Closing alert settings |
| [07-role-management.png](07-role-management.png) | Role catalog |
| [08-avatar-upload-success.png](08-avatar-upload-success.png) | Successful avatar upload |
| [09-deal-attachment-upload-success.png](09-deal-attachment-upload-success.png) | Successful private PDF attachment upload |
| [10-mobile-dashboard.png](10-mobile-dashboard.png), [15-mobile-my-work.png](15-mobile-my-work.png) | Earlier mobile layouts |
| [11-team-invitations.png](11-team-invitations.png) | Team invitations and role roster |
| [12-ic-approvals.png](12-ic-approvals.png) | Earlier IC approval inbox |
| [13-my-work-dashboard.png](13-my-work-dashboard.png) | Earlier My Work dashboard |
