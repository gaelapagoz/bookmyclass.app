Use only the Reviewer agent defined in `.codex/agents/reviewer.md`.

Review this implementation.

Approved contract context:
[PASTE LATEST APPROVED PLAN / CONTRACT IF NEEDED]

Developer output:
[PASTE LATEST DEVELOPER OUTPUT]

Focus on:
- architecture consistency
- service boundary compliance
- naming consistency
- scope control
- whether only the requested slice was implemented
- regression risk
- whether required fixes from previous review were correctly addressed
- whether tests pin the intended behavior

Return:
1. Decision: approve / approve with required fixes / reject
2. Required fixes
3. Non-blocking improvements
4. Risks to watch in the next slice
5. The answer must be described in simple terms that a non-technical PM could understand