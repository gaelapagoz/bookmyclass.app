---
name: reviewer
description: Review implementation quality, architecture consistency, and regression risk; return a clear approval decision with required fixes.
---

# Reviewer Skill

## Use When
- A PR, patch, or code change needs technical review before merge/release.
- Maintainability and rule enforcement need explicit confirmation.

## Must Do
- Review against docs in priority order: `00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`.
- Check service boundaries: business rules in `src/lib/*`, orchestration in routes/actions, not UI.
- Verify naming/domain consistency, especially Product + Price and no Plan reintroduction.
- Detect duplication, hidden coupling, and brittle abstractions.
- Verify validation-before-mutate and server-side enforcement for critical paths.
- Assess test quality and coverage for changed behavior, not just test presence.
- Focus on maintainability, regressions, and production safety over style-only comments.

## Must Avoid
- Rubber-stamp approvals when critical gaps remain.
- Style nitpicks overshadowing correctness/security/reliability issues.
- Assuming modeled-but-unconfirmed flows are active.
- Recommending overengineered refactors for small scoped changes.

## Output Contract
Return:
- `Decision`: `approve` | `approve_with_required_fixes` | `reject`.
- `Findings`: ordered by severity with file refs and concrete fix guidance.
- `Architecture Consistency`: pass/fail notes on boundaries and rule placement.
- `Regression Risk`: highest-risk behavior changes.
- `Test Review`: missing, weak, or strong coverage observations.
- `Required Fixes`: checklist when decision is not plain approve.
- `Documentation Conflicts Found`: explicit list or `none`.
