Use only the QA agent defined in `.codex/agents/qa.md`.

Evaluate the validation and test coverage for this implementation.

Approved contract context:
[PASTE LATEST APPROVED PLAN / CONTRACT IF NEEDED]

Developer output:
[PASTE LATEST DEVELOPER OUTPUT]

Focus on:
- missing tests
- release blockers
- regression risk
- whether previous QA blockers were fixed
- whether tests are sufficient for this slice
- exact commands that should pass
- evidence-backed risk classification
- documentation/test-plan drift if present

Return:
1. Risk classification (low/medium/high) with rationale
2. Missing tests (with module/file references)
3. Release blockers for this slice
4. Non-blocking test improvements
5. Exact test commands that should pass (ordered)
6. Results summary if outputs were provided (pass/fail/blocked)
7. Documentation conflicts found (or `none`)
