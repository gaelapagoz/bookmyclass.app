# Codex Rulebook

Purpose: implementation behavior and guardrails for Codex work in this repository.

## Documentation Hierarchy (Required)

Use documentation in this exact order:

1. `docs/system-baseline.md`
2. `docs/deployment-baseline.md`
3. `docs/business-rules.md`
4. `docs/domain-rules.md`
5. `docs/subscription-domain-rules.md`
6. `docs/testing-rulebook.md`
7. `docs/testing-checklist.md`
8. Setup/runbook docs (`00`, `01`, `02`, `03`, `04`, `05`, `06`, `07`, `20`, `21`, `22`) as procedural references only

## Conflict Resolution Rules

- If two docs conflict on current-state architecture or active capabilities, `system-baseline.md` is authoritative.
- If two docs conflict on deployment/runtime facts (host/IP, ports, PM2 app, container names, cron, env naming), `deployment-baseline.md` is authoritative.
- Setup/runbook docs must never be treated as primary truth when they conflict with baseline files.
- If baseline files still contain `NEEDS_OPERATOR_CONFIRMATION`, do not guess. Surface the gap explicitly.

## Capability Assumption Rule

- Do not assume a modeled capability is implemented only because it exists in Prisma schema or domain docs.
- A capability is treated as active only when `system-baseline.md` says it is active/confirmed.
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
