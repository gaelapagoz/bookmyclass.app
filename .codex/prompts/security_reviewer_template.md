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
1. Security verdict: pass / pass_with_hardening / block_release
2. Findings by severity with file/module references
3. Required security fixes
4. Non-blocking concerns
5. Auth/AuthZ review summary
6. Validation review summary
7. Webhook/payment replay-idempotency review summary
8. Safe to proceed to the next slice? yes/no
9. Documentation conflicts found (or `none`)
