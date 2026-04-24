---
name: architecture-review
description: Check architecture consistency, service boundaries, and regression risk for a proposed or implemented change.
---

# Architecture Review

## Purpose
Run a focused architecture check on a change request, plan, or implementation.

## Checklist
- Confirm business logic remains in `src/lib/*`.
- Confirm API routes and server actions orchestrate only.
- Check service/module naming consistency with existing patterns.
- Check scope control: no unrelated abstractions or broad rewrites.
- Check boundary integrity across auth, booking, checkout, admin, and attendance flows.
- Identify regression risk from coupling, duplicated rules, or changed data contracts.

## Output
Return:
- `Architecture Verdict`: `aligned` or `misaligned`.
- `Findings`: ordered by severity with file/doc references.
- `Regression Risk`: high-level impact and affected flows.
- `Required Corrections`: minimal, surgical actions.
- `Documentation Conflicts Found`: explicit list or `none`.
