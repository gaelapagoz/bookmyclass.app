Use only the Docs agent defined in `.codex/agents/docs.md`.

Update project documentation for the completed implementation.

Feature context:
[PASTE FEATURE / SLICE CONTEXT]

Implementation output:
[PASTE FINAL APPROVED DEVELOPER OUTPUT]

Relevant reviewer/security/QA notes:
[PASTE ANY IMPORTANT FINAL NOTES]

Requirements:
- Update only documentation impacted by the implementation
- Keep documentation truthful and aligned with the actual code
- Do not document future or planned behavior that is not implemented
- Update any impacted flows, contracts, tests, deployment notes, or operational behavior
- Preserve baseline authority from `docs/00_01_system_baseline.md` and `docs/00_02_deployment_baseline.md`
- Follow docs source priority: `docs/00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`
- Mention any remaining accepted risks or deferred work if relevant

Return:
1. Docs updated (exact files + purpose per file)
2. Exact sections changed per file
3. Behavior sync summary (code/runtime -> docs mapping)
4. Baseline authority check (`00_01` and `00_02` preserved)
5. Active vs modeled capability notes added (if any)
6. Impacted services/modules referenced by doc updates
7. Impacted tests/checklists reflected in docs
8. Missing documentation to create (if any)
9. Documentation conflicts found (or `none`)
10. Follow-up docs deferred (if any)
