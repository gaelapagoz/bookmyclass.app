---
name: test-planning
description: Determine minimum sufficient unit/integration/ui/e2e coverage and exact commands for a change.
---

# Test Planning

## Purpose
Decide the smallest effective test plan based on change risk.

## Procedure
- Map changed files and behavior to impacted modules and user flows.
- Classify risk as `low`, `medium`, or `high`.
- Select required test types:
  - `unit` for pure/domain logic changes.
  - `integration` for service orchestration, DB, or API boundaries.
  - `ui` for client-visible behavior or server-action wiring.
  - `e2e` only for critical cross-flow risk.
- Define exact commands in execution order.
- Mark tests as required vs optional for this slice.

## Output
Return:
- `Risk Classification` with rationale.
- `Required Tests` by type and file/flow target.
- `Command Plan` with exact commands in order.
- `Coverage Gaps` and acceptable residual risk.
- `Documentation Conflicts Found`: explicit list or `none`.
