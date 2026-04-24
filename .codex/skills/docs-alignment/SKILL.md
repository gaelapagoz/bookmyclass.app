---
name: docs-alignment
description: Check doc-priority alignment, conflict handling, and active-vs-modeled capability assumptions.
---

# Docs Alignment

## Purpose
Verify decisions and implementation are aligned with repository documentation hierarchy.

## Procedure
- Read docs in required priority order.
- Flag any conflict and apply baseline authority rules.
- Verify no assumption treats modeled capabilities as active unless baseline confirms.
- Verify summary includes impacted files/modules/tests and documentation conflict status.

## Output
Return:
- `Alignment Verdict`: `aligned` or `misaligned`.
- `Conflicts`: list with authoritative source, or `none`.
- `Active vs Modeled Risks`: list, or `none`.
- `Required Corrections`: minimal actions.
