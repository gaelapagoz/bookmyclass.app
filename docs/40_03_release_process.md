# Release Process

Purpose: define the canonical release process for this repository.

---

## Current UAT Status

UAT is operational for operator-run manual validation. UAT checks are triggered
by the operator when release scope requires deployed-environment smoke,
security, performance, or E2E evidence; UAT is not an automatic release gate.

Current release validation relies on CI, local targeted validation, Stripe CLI
simulation for payment/webhook changes, manual production approval, production
smoke checks, and observability review. Smoke, security, and performance checks
are operator-run manual gates.

---

## Core Principles

- main is integration state, not deployable state
- Only git tags (vX.Y.Z) are deployable
- UAT is operational for manual operator validation
- Production must always run a locally/CI-validated tag
- Never deploy directly from main to production
- Production deployment remains manual, explicit, and approval-gated

---

## Canonical Release Sequence

1. Merge changes into main (via PR, CI must pass)
2. Create release tag (vX.Y.Z)
3. Run local/CI validation appropriate to the change:
   - full regression suite
   - e2e (if applicable)
   - Stripe CLI webhook simulation for payment/webhook changes
   - operator-run smoke, security, and performance checks when applicable
4. Run operator-approved UAT validation when release scope requires it
5. Promote the exact validated tag to production through the manual workflow
6. Run post-deploy production smoke and observability checks

Rule:
- Do not deploy directly from unvalidated main to production

---

## GitHub Actions Tag Release (Operator-Run UAT)

The UAT release workflow is available for operator-run validation and should be
triggered only when the operator approves UAT validation for the target tag.

For `v*` tag pushes, workflow `.github/workflows/uat-release.yml` runs:
1. `regression` (pre-deploy build/test/validation)
2. `e2e` (pre-deploy CI e2e)
3. `deploy_uat` (exact tag deploy over SSH)
4. `smoke_uat` (public UAT smoke checks)
5. `e2e_uat` (narrow deployed-UAT release e2e)
6. `k6_smoke_uat` (short non-booking k6 smoke profile)
7. `zap_uat` (OWASP ZAP baseline)

Flat release view:
- `regression -> e2e -> deploy_uat -> smoke_uat -> e2e_uat -> k6_smoke_uat -> zap_uat`

These jobs are operator-run validation steps and are not automatic release
blockers.

Regression gate includes fail-fast coverage validation before expensive e2e:
- `npm run qa:e2e:coverage`
- Unknown `@covers` / `@covers-partial` IDs fail the gate immediately.

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
- `E2E_TEST_SECRET`

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

## Manual Production Promotion

Production promotion uses `.github/workflows/prod-release.yml`.

Rules:
- Triggered only by `workflow_dispatch`
- Requires explicit `tag` input
- Deploys an exact tag only, never a branch
- Uses separate production SSH secrets/variables
- Uses `environment: production` on deploy job for approval protection
- Runs small post-deploy production smoke checks
- Production smoke checks are split-topology aware (`bookmyclass.app`, `www.bookmyclass.app`, `demo.bookmyclass.app`, `demo.bookmyclass.app/api/health`)
- Uploads deploy/smoke artifacts on failure

Required production secrets:
- `PROD_SSH_HOST`
- `PROD_SSH_PORT`
- `PROD_SSH_USER`
- `PROD_SSH_PRIVATE_KEY`
- `PROD_SSH_KNOWN_HOSTS`
- `PROD_BASE_URL`

Optional production variables:
- `PROD_APP_DIR`
- `PROD_PM2_APP_NAME`

Production flat view:
- CI/local validation validates the tag first
- Production promotion manually deploys the exact validated tag

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

Production split topology note:
- Marketing host health: `https://bookmyclass.app/`
- App health endpoint: `https://demo.bookmyclass.app/api/health`

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

## Booking Partial-Index Migration Gate

When a release includes the booking active-uniqueness migration, run this SQL
against the target production database before `npx prisma migrate deploy`:

```sql
SELECT "clientId", "studioSessionId", COUNT(*)
FROM "Booking"
WHERE "status" IN ('PENDING', 'CONFIRMED')
GROUP BY "clientId", "studioSessionId"
HAVING COUNT(*) > 1;
```

Expected result: 0 rows.

If any rows are returned:
- Stop the deploy.
- Do not run the migration.
- Produce a manual cleanup plan for the duplicate active bookings.
- Preserve all historical cancelled/expired booking rows.

The migration must create the PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX "Booking_active_client_session_unique"
ON "Booking" ("clientId", "studioSessionId")
WHERE "status" IN ('PENDING', 'CONFIRMED');
```

Prisma cannot fully represent this partial unique index. The index is
migration-owned, and broad `@@unique([clientId, studioSessionId])` must not be
reintroduced after the migration.

Rollback may recreate the original broad unique constraint only if the database
has no multiple historical rows for a client/session pair. Never delete booking
history automatically during rollback.

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
- E2E coverage matrix check must pass (`npm run qa:e2e:coverage`)
- Prisma migration status must be valid

Defined in:
- .github/workflows/ci.yml

---

## Known Constraints

- UAT is operational for operator-run manual validation
- Production deployment remains manual, explicit, and approval-gated
- Infrastructure values (host, DB name, etc.) must not be guessed

---

## Canonical References

- docs/00_02_deployment_baseline.md
- docs/00_01_system_baseline.md
- .github/workflows/ci.yml
- .github/workflows/uat-release.yml
- .github/workflows/prod-release.yml
- scripts/verify-production-readiness.sh
- docs/50_02_bookmyclass_server_setup_updated.md
- docs/50_13_uat_security_operator_runbook.md
- docs/30_03_security_testing_checklist.md



