# Codex Rulebook

Purpose: implementation behavior and guardrails for Codex work in this repository.

## Documentation Hierarchy (Required)

Use documentation in this exact order:

1. `docs/00_01_system_baseline.md`
2. `docs/00_02_deployment_baseline.md`
3. `docs/10_01_business_rules.md`
4. `docs/10_02_domain_rules.md`
5. `docs/10_03_subscription_domain_rules.md`
6. `docs/20_01_architecture_overview.md`
7. `docs/20_02_service_boundaries.md`
8. `docs/20_03_backend_patterns.md`
9. `docs/20_04_frontend_guidelines.md`
10. `docs/30_01_testing_rulebook.md`
11. `docs/30_02_testing_checklist.md`
12. `docs/40_*`, `docs/60_*`, `docs/70_*`, and setup/runbook docs (`50_01` through `50_11`) as supporting references only

## Conflict Resolution Rules

- If two docs conflict on current-state architecture or active capabilities, `00_01_system_baseline.md` is authoritative.
- If two docs conflict on deployment/runtime facts (host/IP, ports, PM2 app, container names, cron, env naming), `00_02_deployment_baseline.md` is authoritative.
- Setup/runbook docs must never be treated as primary truth when they conflict with baseline files.
- If baseline files still contain `NEEDS_OPERATOR_CONFIRMATION`, do not guess. Surface the gap explicitly.

## Capability Assumption Rule

- Do not assume a modeled capability is implemented only because it exists in Prisma schema or domain docs.
- A capability is treated as active only when `00_01_system_baseline.md` says it is active/confirmed.
- Modeled but not active flows must be treated as unsupported for delivery planning and acceptance checks.

## Implementation Rules

- No business logic in frontend components.
- Always validate before mutate.
- Keep domain/business logic in service modules (`src/lib/*`).
- Reuse existing services and validators; avoid duplicated rule implementations.
- Preserve production safety: fail fast on missing required configuration for changed flows.

## Pre-Implementation Checklist (Required in task summary)

Before implementation, explicitly list:

1. Impacted files
2. Impacted services/modules
3. Impacted tests (existing and new)
4. Documentation conflicts found (if any)

If no conflict exists, state: `Documentation conflicts found: none`.

## Testing Expectations

- For behavior changes: add/update relevant tests.
- For docs-only changes: state explicitly that no code-path tests were required.
- Handoff must include exact test commands run, or a clear statement that tests were not applicable.

## Working Style

- Prefer minimal, surgical edits over broad rewrites.
- Keep naming and architecture consistent with the existing codebase.
- Do not invent new architecture or domain abstractions unless explicitly requested.


