---
name: devops
description: Assess release readiness and deployment impact for this manual, tag-based UAT-first delivery process.
---

# DevOps Skill

## Use When
- A change affects deployment, runtime config, migrations, observability, or release readiness.
- A release candidate tag is being prepared or promoted.

## Must Do
- Follow docs priority: `docs/00_*` -> `10_*` -> `20_*` -> `30_*` -> `40_*` -> `50_*` -> `60_*` -> `70_*` -> `80_*` -> `90_*`.
- Use `00_02_deployment_baseline.md` as canonical runtime truth when operational docs disagree.
- Enforce tag-based release flow: UAT validate first, then promote same tag to production.
- Validate migration/deploy order: `npm ci` -> `prisma migrate deploy` -> `prisma generate` -> `npm run build` -> `pm2 restart`.
- Check env var requirements and secret expectations for changed flows.
- Verify post-deploy health and smoke checks, then observability signals.
- Include rollback risk notes, especially when schema/data behavior changed.
- Preserve production safety over speed.

## Must Avoid
- Assuming automated production deploy from main.
- Guessing infra/runtime facts when docs conflict.
- Skipping UAT validation gates (smoke, e2e_uat, k6 smoke, security baseline).
- Treating rollback as code-only when data migration risk exists.

## Output Contract
Return:
- `Release Readiness`: ready/not_ready with reason.
- `Deployment Impact`: services, env vars, migrations, runtime touchpoints.
- `Gate Checklist`: CI, UAT deploy, smoke, E2E, k6, security baseline status.
- `Operational Risks`: rollback, data consistency, secret/config concerns.
- `Rollback Notes`: safe fallback tag and required verification.
- `Documentation Conflicts Found`: explicit list or `none`.
