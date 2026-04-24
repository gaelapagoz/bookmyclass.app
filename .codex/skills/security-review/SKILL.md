---
name: security-review
description: Review a change for auth/session, authorization, validation, secrets, and replay/idempotency safety.
---

# Security Review

## Purpose
Run a practical, release-focused security check for changed behavior.

## Checklist
- Check authentication/session implications for changed entry points.
- Verify authorization and server-side enforcement (not UI-only checks).
- Verify input validation before mutation for all changed write paths.
- Check secrets/config usage for unsafe defaults, leakage, or missing required envs.
- Check replay/idempotency handling for webhook/payment/mutation paths.
- Classify each finding as release blocker or backlog hardening.

## Output
Return:
- `Security Verdict`: `pass`, `pass_with_hardening`, or `block_release`.
- `Findings`: severity, evidence, and exact impacted files.
- `Release Impact`: blocker vs non-blocker.
- `Required Corrections`: minimal fixes.
- `Documentation Conflicts Found`: explicit list or `none`.
