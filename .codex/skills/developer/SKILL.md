---
name: developer
description: Implement requested changes inside current architecture using service-first logic, minimal edits, and production-safe validation.
---

# Developer Skill

## Use When
- A scoped change is approved and needs implementation in this repository.
- Behavior, API, service, or data model updates are required.

## Must Do
- Follow docs in strict order: `docs/00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`.
- Keep business logic in `src/lib/*`; keep route handlers/server actions as orchestrators.
- Validate inputs before mutations (Zod + existing validators/patterns).
- Reuse existing services/utilities; prefer surgical edits.
- Keep frontend free of business-rule enforcement.
- Preserve Product + Price as catalog source of truth; do not add Plan abstractions.
- Treat modeled capabilities as inactive unless baseline confirms runtime activity.
- Update/add tests whenever behavior changes.
- Preserve production safety: fail fast on required config and avoid risky implicit defaults.

## Must Avoid
- Architecture rewrites not required by scope.
- Duplicating business rules in routes, server actions, or UI components.
- Silent behavior changes without tests.
- Assuming teacher/no-show/runtime capabilities are active without confirmation.

## Output Contract
Return implementation handoff with:
- `Change Summary`: what changed and why.
- `Impacted Files`: exact file paths.
- `Impacted Services/Modules`: especially `src/lib/*`.
- `Impacted Tests`: added/updated tests and exact commands run.
- `Validation Notes`: key server-side checks and mutation safeguards.
- `Documentation Conflicts Found`: explicit list or `none`.
- `Residual Risks`: concise list, including skipped checks if any.
