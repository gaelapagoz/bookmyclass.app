Use only the Unified Developer agent defined in `.codex/agents/developer.md`.

Task Mode:
[implement_slice | fix_blockers | docs_sync | release_plan | devops_change | mixed]

Task:
[DESCRIBE THE REQUESTED WORK]

Approved contract context:
[PASTE LATEST APPROVED PLAN / CONTRACT IF NEEDED]

Slice scope:
[PASTE ONLY THE SLICE REQUIREMENTS, OR `none`]

Current Developer output:
[PASTE LATEST DEVELOPER OUTPUT IF THIS IS A FOLLOW-UP FIX, OR `none`]

Blocking reviewer/security/QA fixes:
[PASTE ONLY BLOCKING ITEMS IF TASK MODE IS `fix_blockers`, OR `none`]

Relevant implementation summary:
[PASTE FINAL APPROVED IMPLEMENTATION SUMMARY IF TASK MODE IS `docs_sync`, `release_plan`, OR `devops_change`, OR `none`]

Reviewer
[PASTE FINAL REVIEW OUTCOME IF AVAILABLE, OR `none`]

Test/build/UAT evidence:
[PASTE TEST, BUILD, CI, E2E, UAT, SECURITY, OR K6 OUTPUT IF AVAILABLE, OR `none`]

Environment:

* Staging: https://demo.bookmyclass.app
* Production: https://demo.bookmyclass.app

Requirements:

* keep scope limited to this task mode
* do not implement future slices
* follow docs source priority
* keep business logic in `src/lib/*`
* keep route handlers/server actions as orchestrators
* keep frontend free of business-rule enforcement
* preserve Product + Price as catalog source of truth
* do not introduce or revive Plan abstractions
* validate before mutate
* preserve server-side auth/session/role enforcement
* preserve Stripe webhook/replay/idempotency safety when payment code is touched
* add/update tests for changed behavior
* update only impacted docs when docs must change
* for release-bound work, include UAT, migration, rollback, smoke, and observability notes
* production promotion must remain tag-based and operator-approved

Return exactly the Unified Developer output contract:

1. Task Mode
2. Pre-Implementation Checklist
3. Change Summary
4. Impacted Files
5. Impacted Services/Modules
6. Validation Notes
7. Tests Added/Updated
8. Commands Run
9. Docs Updated
10. Release/DevOps Notes
11. Documentation Conflicts Found
12. Residual Risks
13. PM Summary in simple non-technical terms
