# Release Process

Purpose: define the canonical, operator-driven release process for this repository.

This project uses a manual deployment model.
There is no automated CI/CD deployment pipeline.

---

## Core Principles

- main is integration state, not deployable state
- Only git tags (vX.Y.Z) are deployable
- UAT must validate a release before production
- Production must always run a previously validated tag
- Never deploy directly from main to production

---

## Canonical Release Sequence

1. Merge changes into main (via PR, CI must pass)
2. Create release tag (vX.Y.Z)
3. Deploy tag to UAT
4. Validate in UAT:
   - manual flows
   - e2e (if applicable)
   - load testing (k6, when applicable)
5. Promote the same validated tag to production

Rule:
- Do not deploy directly from unvalidated main to production

---

## Git Tagging

Create a release tag from main:

git checkout main
git pull origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z

---

## Manual Deployment Checklist (UAT / Production)

Run on target server:

git fetch --tags
git checkout vX.Y.Z
npm ci
npx prisma migrate deploy
npm run build
pm2 restart bookmyclass-app --update-env

Notes:
- PM2 app name: bookmyclass-app
- Do not skip migrate deploy
- Do not deploy from main

---

## Post-Deploy Verification

### 1. Health Check (MANDATORY)

curl -i https://<ENV_DOMAIN>/api/health

Expected:
- HTTP 200
- Database connectivity OK

---

### 2. Smoke Tests (MANDATORY)

Validate:

- homepage loads
- sign-in works
- booking flow loads
- admin access works

---

### 3. Observability Check

Verify:

- no immediate errors in logs (PM2)
- Sentry is receiving errors (if triggered)
- monitoring is green (Uptime Kuma)

---

## Production Readiness Gate (MANDATORY)

Before deploying to production, run:

npm run ops:verify-production-readiness -- \
  --confirm-kuma \
  --confirm-backup-heartbeat \
  --confirm-local-healthcheck \
  --confirm-latest-backup \
  --confirm-restore-proof

This confirms:

- monitoring is active
- backups are running
- restore has been validated

Do not skip this step.

---

## Rollback Procedure (Manual)

Rollback to a previous tag:

git fetch --tags
git checkout <PREVIOUS_TAG>
npm ci
npx prisma migrate deploy
npm run build
pm2 restart bookmyclass-app --update-env

Then verify:

curl -i https://<ENV_DOMAIN>/api/health

---

## Rollback Rules

- Only rollback to a previously working tag
- Rollback does not guarantee data consistency if schema/data changed
- If data corruption is suspected:
  - restore database backup
  - then redeploy known-good tag

---

## Quality Gates in Repository

- CI build must pass
- Test suite must pass
- Prisma migration status must be valid

Defined in:
- .github/workflows/ci.yml

---

## Known Constraints

- No automated deployment pipeline
- No GitHub Actions deploy job
- Deployment is operator-driven
- Infrastructure values (host, DB name, etc.) must not be guessed

---

## Canonical References

- docs/00_02_deployment_baseline.md
- docs/00_01_system_baseline.md
- .github/workflows/ci.yml
- scripts/verify-production-readiness.sh
- docs/50_02_bookmyclass_server_setup_updated.md
