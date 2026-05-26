Use only the Security Reviewer agent defined in `.codex/agents/security-reviewer.md`.

Review this implementation for security and correctness risks.

Approved contract context:
[PASTE LATEST APPROVED PLAN / CONTRACT IF NEEDED]

Developer output:
[PASTE LATEST DEVELOPER OUTPUT]

Focus on:
- auth/session implications
- replay/idempotency implications
- validation completeness
- deterministic behavior
- server-side enforcement
- unsafe assumptions
- whether required security fixes from previous review were correctly addressed
- release impact (blocker vs backlog)

Return:
1. Decision: approve / approve with required fixes / reject
2. Security verdict: pass / pass_with_hardening / block_release
3. Findings by severity with file/module references
4. Required security fixes
5. Non-blocking concerns
6. Auth/AuthZ review summary
7. Validation review summary
8. Webhook/payment replay-idempotency review summary
9. Safe to proceed to the next slice? yes/no
10. Documentation conflicts found (or `none`)
11. The answer must be described in simple terms that a non-technical PM could understand
