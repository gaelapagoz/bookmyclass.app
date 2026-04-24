Planner loop overlay. Primary source of truth is `.codex/agents/planner.md`.

Do not duplicate or override agent fundamentals unless explicitly stated below.

Loop-specific additions:
- Focus scope on local operator tooling only.
- Do not modify application runtime code.
- Do not introduce new app architecture.
- Enforce repository documentation priority:
1. docs/00_01_system_baseline.md
2. docs/00_02_deployment_baseline.md
3. docs/10_01_business_rules.md
4. docs/10_02_domain_rules.md
5. docs/10_03_subscription_domain_rules.md
6. docs/20_*
7. docs/90_01_codex_rulebook.md
8. docs/30_*

Planner output must explicitly cover:
- impacted files
- impacted services/modules
- impacted tests
- documentation conflicts
- service boundary compliance
- validation/server-side enforcement
- regression risk
