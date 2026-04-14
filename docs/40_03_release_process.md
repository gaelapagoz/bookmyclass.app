# Release Process

Purpose: define the canonical release process for this repository.

---

## Core Principles

- main is integration state, not deployable state
- Only git tags (vX.Y.Z) are deployable
- UAT must validate a release before production
- UAT security baseline (OWASP ZAP baseline) is a mandatory validation gate before promotion
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
   - security baseline testing (OWASP ZAP baseline against UAT)
5. Promote the same validated tag to production

Rule:
- Do not deploy directly from unvalidated main to production

---

## GitHub Actions Tag Release (UAT only)

For `v*` tag pushes, workflow `.github/workflows/uat-release.yml` runs:
1. CI job (build, tests, Prisma checks)
2. Deploy exact tag to UAT over SSH
3. Run `npm run test:uat:smoke` from the GitHub runner against public UAT URL
4. Run deployed-UAT release e2e suite (`npm run test:e2e:uat`)
5. Stop on failure (no production deployment in this workflow)

This preserves immutable tag deployment because deploy and smoke jobs both use `${github.ref}` / `${github.ref_name}`.

### Required secrets

- `UAT_SSH_HOST`
- `UAT_SSH_PORT`
- `UAT_SSH_USER`
- `UAT_SSH_PRIVATE_KEY`
- `UAT_SSH_KNOWN_HOSTS`
- `UAT_BASE_URL`
- `UAT_E2E_EMAIL`
- `UAT_E2E_PASSWORD`

### Optional repository/environment variables

- `UAT_APP_DIR` (defaults to script value when unset)
- `UAT_PM2_APP_NAME` (defaults to script value when unset)

### SSH safety model

- Uses deploy user from `UAT_SSH_USER` (no root requirement)
- Writes private key to `~/.ssh/id_ed25519`
- Writes host fingerprints from `UAT_SSH_KNOWN_HOSTS` to `~/.ssh/known_hosts`
- Enforces:
  - `StrictHostKeyChecking yes`
  - `UserKnownHostsFile ~/.ssh/known_hosts`
  - `IdentitiesOnly yes`
- Host key checking is never disabled

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

git fetch --all --tags
git checkout vX.Y.Z
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart bookmyclass-app --update-env

Notes:
- PM2 app name: bookmyclass-app
- Do not skip migrate deploy
- Do not deploy from main

---

## Server deploy command order

For UAT and Production, after checking out the release tag, use this command order:

```bash
git fetch --all --tags
git checkout vX.Y.Z
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart bookmyclass-app --update-env
```

### Command meaning

* `git fetch --all --tags` pulls latest remote refs and tags
* `git checkout vX.Y.Z` switches the server to the exact release version
* `npm ci` installs dependencies exactly from `package-lock.json`
* `npx prisma migrate deploy` applies committed migrations to the target database
* `npx prisma generate` regenerates Prisma client artifacts for the checked out version
* `npm run build` builds the Next.js application
* `pm2 restart bookmyclass-app --update-env` restarts the app with the current environment

### Rules

* Always deploy from a tag, never from `main`
* Always run `npm ci` before build on UAT/Production
* Always run `npx prisma migrate deploy` before `npx prisma generate`
* Always run `npx prisma generate` before `npm run build`
* Always restart PM2 only after a successful build

### Notes

* `prisma migrate deploy` changes the database schema
* `prisma generate` updates the generated Prisma client
* These are different steps and both are required in deployment flow
* This sequence must be used consistently in both UAT and Production

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

git fetch --all --tags
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

- Tag-triggered automation covers UAT deploy + smoke + release e2e only
- UAT e2e/security/load validation still requires additional jobs or operator runbooks
- Production deployment remains operator-driven
- Infrastructure values (host, DB name, etc.) must not be guessed

---

## Canonical References

- docs/00_02_deployment_baseline.md
- docs/00_01_system_baseline.md
- .github/workflows/ci.yml
- .github/workflows/uat-release.yml
- scripts/verify-production-readiness.sh
- docs/50_02_bookmyclass_server_setup_updated.md
- docs/50_13_uat_security_operator_runbook.md
- docs/30_03_security_testing_checklist.md



