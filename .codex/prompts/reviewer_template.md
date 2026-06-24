Use only the Unified Reviewer agent defined in `.codex/agents/reviewer.md`.

Review this implementation for architecture, correctness, security, test coverage, and release readiness.

Approved contract context:
[PASTE LATEST APPROVED PLAN / CONTRACT IF NEEDED]

Previous review blockers or required fixes:
[PASTE PREVIOUS REVIEW OUTPUT IF APPLICABLE]

Developer output:
[PASTE LATEST DEVELOPER OUTPUT]

Test/build output:
[PASTE TEST, BUILD, LINT, E2E, UAT, SECURITY, OR K6 OUTPUT IF AVAILABLE]

Focus on:

* whether only the requested slice was implemented
* architecture and service-boundary compliance
* Product + Price naming consistency; no Plan reintroduction
* server-side auth/session/role enforcement
* validation-before-mutate completeness
* Stripe webhook/payment replay and idempotency implications
* unsafe env/config/secret assumptions
* regression risk in auth, booking, checkout, webhook, cancellation, admin, teacher flows
* whether previous reviewer/security/QA blockers were correctly fixed
* whether tests pin the intended behavior
* whether release blockers remain
* documentation or test-plan drift

Return exactly the Unified Reviewer output contract:

1. Decision: approve / approve_with_required_fixes / reject
2. Security Verdict: pass / pass_with_hardening / block_release
3. Risk Classification: low / medium / high with rationale
4. Findings by severity with file/module references
5. Required Fixes
6. Architecture Review
7. Security Review
8. Test Review
9. Test Commands in exact order
10. Results Summary
11. Release Gate Status
12. Next-Slice Risks
13. PM Summary in simple non-technical terms
14. Documentation Conflicts Found, or `none`