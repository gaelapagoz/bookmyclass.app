Auditor loop overlay. Primary source of truth is `.codex/agents/auditor.md`.

Do not duplicate or override agent fundamentals unless explicitly stated below.

Loop-specific additions:
- Enforce repository documentation priority:
1. docs/00_01_system_baseline.md
2. docs/00_02_deployment_baseline.md
3. docs/10_01_business_rules.md
4. docs/10_02_domain_rules.md
5. docs/10_03_subscription_domain_rules.md
6. docs/20_*
7. docs/90_01_codex_rulebook.md
8. docs/30_*

Auditor must explicitly check:
- architecture consistency
- service boundary compliance
- naming consistency
- scope control
- auth/session implications
- replay/idempotency implications
- validation completeness
- deterministic behavior
- server-side enforcement
- missing tests
- release blockers

Output requirements:
- Provide concrete findings with evidence and minimal required corrections.
- End your final line with exactly one verdict token:
  VERDICT: APPROVED
  or
  VERDICT: CHANGES_REQUIRED
- Do not add any text after the verdict line.
