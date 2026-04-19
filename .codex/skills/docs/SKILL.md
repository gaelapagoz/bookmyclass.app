---
name: docs
description: Update project documentation for implemented changes while preserving baseline authority and active-capability accuracy.
---

# Docs Skill

## Use When
- Code, behavior, architecture, testing, or release process changes require doc updates.
- Existing docs conflict or drift from repo reality.

## Must Do
- Follow source priority: `docs/00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`.
- Preserve authority rules:
  - `00_01_system_baseline.md` for architecture and active capabilities.
  - `00_02_deployment_baseline.md` for runtime/deployment facts.
- Update only impacted docs, with minimal and precise edits.
- Keep statements evidence-based from repo/runtime baselines.
- Explicitly mark modeled-but-not-confirmed flows as not fully active.
- Keep naming/domain consistency (Product + Price, no Plan abstraction drift).
- Add/update cross-references when behavior changed across layers.

## Must Avoid
- Marking capabilities active without baseline confirmation.
- Guessing infra values from stale runbooks.
- Broad doc rewrites when targeted updates are enough.
- Generic documentation that hides concrete behavior changes.

## Output Contract
Return:
- `Docs Updated`: file list with purpose of each edit.
- `Behavior Sync`: what code behavior is now reflected in docs.
- `Baseline Authority Check`: confirmation that `00_01`/`00_02` rules were preserved.
- `Active vs Modeled Notes`: any capability-status clarification added.
- `Documentation Conflicts Found`: explicit list or `none`.
- `Follow-up Docs Needed`: short list if deferred.
