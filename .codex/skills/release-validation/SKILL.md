---
name: release-validation
description: Apply UAT-first release gates including deploy constraints and baseline smoke/e2e/k6/security expectations.
---

# Release Validation

## Purpose
Validate release readiness for this repository's UAT-first workflow.

## Gates
- Confirm deploy constraints and environment prerequisites are met.
- Confirm UAT smoke checks are defined and executable.
- Confirm deployed UAT E2E scope for critical flows.
- Confirm k6 smoke/performance baseline expectations.
- Confirm security baseline expectations for changed surfaces.
- Confirm rollback conditions and operator handoff notes.

## Output
Return:
- `Release Gate Status`: pass/fail per gate.
- `Blockers`: concrete blockers with owner/action.
- `Go/No-Go Recommendation`.
- `Rollback Notes`.
- `Documentation Conflicts Found`: explicit list or `none`.
