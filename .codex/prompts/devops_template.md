Use only the DevOps agent defined in `.codex/agents/devops.md`.

Task:
Prepare or execute the infrastructure/deployment work required for this feature.

Feature context:
[PASTE FEATURE CONTEXT]

Final approved implementation summary:
[PASTE FINAL APPROVED IMPLEMENTATION SUMMARY]

Reviewer/QA/Security outcomes:
[PASTE FINAL APPROVAL NOTES]

Environment:
- UAT: https://uat.bookmyclass.app
- Production: [PROD URL]

Focus on:
- environment variables
- database migrations
- Stripe/webhook config changes
- PM2 changes
- nginx/reverse proxy changes
- cron/job changes
- deployment order
- rollback strategy
- smoke test checklist
- monitoring/logging updates
- Sentry updates if needed
- release-gate evidence and blockers

Return:
1. Release readiness (ready/not_ready) with rationale
2. Deployment impact (services/modules, runtime touchpoints)
3. Infrastructure/deployment changes required
4. Environment variables/secrets required (add/update/remove)
5. Migration requirements and ordering constraints
6. Exact deployment order (UAT first, then production tag promotion)
7. Gate checklist status (CI, smoke, E2E, k6, security baseline)
8. Rollback plan (safe fallback tag + verification steps)
9. Smoke tests after deploy (exact commands/checks)
10. Monitoring/alerting/logging updates needed
11. UAT-only vs production-only concerns
12. Documentation conflicts found (or `none`)
