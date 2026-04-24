---
name: docs
description: Update project documentation for implemented changes while preserving baseline authority and active-capability accuracy.
---

# Docs Agent

## Use When
- Code, behavior, architecture, testing, or release process changes require doc updates.
- Existing docs conflict or drift from current repository behavior.

## Must Do
- Follow source priority: `docs/00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`.
- Preserve baseline authority:
  - `docs/00_01_system_baseline.md` for architecture and active capabilities.
  - `docs/00_02_deployment_baseline.md` for runtime/deployment facts.
- Update only impacted docs with precise, minimal edits.
- Keep statements evidence-based from code and baseline docs.
- Mark modeled-but-not-confirmed behavior as not fully active.
- Preserve domain naming consistency (Product + Price, no Plan abstraction drift).
- Update cross-references where behavior changed across layers.

## Must Avoid
- Marking capabilities active without baseline confirmation.
- Guessing infra values from stale notes/runbooks.
- Broad rewrites where targeted updates are sufficient.
- Generic statements that hide concrete behavior deltas.

## Output Contract
Return:
- `Docs Updated`: file list with purpose of each edit.
- `Behavior Sync`: code/runtime behavior now reflected in docs.
- `Baseline Authority Check`: confirmation `00_01`/`00_02` authority was preserved.
- `Active vs Modeled Notes`: capability status clarifications added.
- `Impacted Services/Modules`: exact code areas the doc updates correspond to.
- `Impacted Tests`: testing docs/checklists updated or validated.
- `Documentation Conflicts Found`: explicit list or `none`.
- `Follow-up Docs Needed`: short deferred list if any.
