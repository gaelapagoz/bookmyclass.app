---
name: release-validation
description: Apply current release gates including deploy constraints, local/CI validation, and operator-run smoke/security/performance checks.
---

# Release Validation

## Purpose
Validate release readiness for this repository's current tag-based workflow while UAT is disabled.

## Gates
- Confirm deploy constraints and environment prerequisites are met.
- Confirm CI and relevant local validation are defined and executable.
- Confirm E2E scope for critical flows.
- Confirm Stripe CLI simulation for payment/webhook changes.
- Assume the operator runs smoke, security, and performance checks manually.
- Capture manual operator-run check status as required release evidence.
- Confirm rollback conditions and operator handoff notes.

## Output
Return:
- `Release Gate Status`: pass/fail per gate.
- `Blockers`: concrete blockers with owner/action.
- `Go/No-Go Recommendation`.
- `Rollback Notes`.
- `Documentation Conflicts Found`: explicit list or `none`.
