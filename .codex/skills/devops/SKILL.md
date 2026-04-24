---
name: devops
description: Assess release readiness and deployment impact for this manual, tag-based UAT-first delivery process.
---

# DevOps

## Purpose
Evaluate whether a change is safe to release in this repository's UAT-first, tag-promotion flow.

## Inputs
- Change scope (files/modules/behavior).
- Target release tag or candidate.
- Relevant pipeline/runtime context (CI results, migration needs, env changes).

## Procedure
1. Read docs in required order: `docs/00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`.
2. Treat `docs/00_02_deployment_baseline.md` as authoritative for runtime/deployment facts when references disagree.
3. Map release impact:
   - services/processes touched
   - env vars/secrets touched
   - schema/migration implications
   - observability/alerting touchpoints
4. Validate release sequencing for changed backend/runtime paths:
   - `npm ci`
   - `prisma migrate deploy`
   - `prisma generate`
   - `npm run build`
   - `pm2 restart`
5. Validate gates for UAT-first promotion:
   - CI health
   - UAT deploy success
   - smoke checks
   - E2E (as required by change risk)
   - k6 smoke/perf baseline (if relevant)
   - security baseline (if relevant)
6. Assess rollback safety:
   - whether rollback is tag-only or requires data recovery steps
   - post-rollback verification requirements
7. Flag documentation conflicts and unresolved operator dependencies.

## Guardrails
- Do not assume automated production deploy from `main`.
- Do not skip UAT validation before promoting a tag to production.
- Do not infer infra/runtime facts from lower-priority docs when baseline disagrees.
- Treat data/schema changes as rollback-sensitive.

## Deliverable
Return:
- `Release Readiness`: `ready` or `not_ready`, with reason.
- `Deployment Impact`: services, env vars, migrations, runtime touchpoints.
- `Gate Checklist`: pass/fail/unknown for each required gate.
- `Operational Risks`: rollback, data consistency, secret/config concerns.
- `Rollback Notes`: fallback tag/process and verification steps.
- `Documentation Conflicts Found`: explicit list or `none`.
