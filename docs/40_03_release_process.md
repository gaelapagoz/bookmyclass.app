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

Demo-stage topology note:
- `UAT_*` GitHub Actions secrets may intentionally point to the same
  production/demo server while PROD is being used as UAT for demonstrations.
- This configuration is supported and must produce a workflow warning, not a
  failure.
- UAT workflow steps should still consume the `UAT_*` secret names; do not wire
  UAT jobs directly to `PROD_*` secrets.

For `v*` tag pushes, workflow `.github/workflows/staging-release.yml` runs:
1. `tag_sanity` (lightweight tag/build/migration/status/secret-target checks)
2. `deploy_staging` (exact tag deploy over SSH)
3. `post_deploy_health_staging` (hard deployed-environment health gate + diagnostics)
4. `smoke_staging` (public staging smoke checks)
5. `e2e_staging` (narrow deployed staging release e2e)
6. `prepare_k6_staging_data` (guarded remote staging DB seed for k6 cohorts when approved)
7. `k6_smoke_staging` (short non-booking k6 smoke profile)
8. `zap_staging` (OWASP ZAP baseline)

Flat release view:
- `tag_sanity -> deploy_staging -> post_deploy_health_staging -> smoke_staging -> e2e_staging -> prepare_k6_staging_data -> k6_smoke_staging -> zap_staging`

These jobs are operator-run validation steps and are not automatic release
blockers.

Validation gate behavior:
- Smoke, E2E, and k6 are hard release gates in staging release workflow execution.
- Steps that pipe command output to `tee` must run under `set -euo pipefail` so failures from the left side of the pipeline are not masked.
- `post_deploy_health_staging` is the first hard deployed-environment gate after deploy. If public `/api/health` is not `200`, the workflow collects SSH diagnostics and fails before smoke/E2E/k6/ZAP.
- k6 staging seed preparation is explicit and operator-guarded (`RUN_STAGING_K6_SEED=YES`) and runs on the staging server only after health/smoke/e2e gates.
- k6 staging seed preparation uses non-reset seed commands only (`db:seed:uat-performance` and `UAT_K6_SEED=1 npm run db:seed:server:k6`); destructive reset commands are not part of staging release workflow.
- Existing GitHub secrets remain `UAT_*` for compatibility; no required `STAGING_*` secret renaming is introduced.

Compatibility notes:
- GitHub secret names remain `UAT_*` for backward compatibility.
- GitHub Environment remains `environment: uat` for backward compatibility.
- Staging command aliases are available: `npm run test:staging:smoke` and
  `npm run test:e2e:staging` map to the existing UAT-backed implementations.

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
- `PROD_DEMO_SSH_HOST` (optional warning-only comparison value for demo-stage
  UAT deployments; defaults to `ssh-prod.bookmyclass.app`)

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
npm ci --include=dev
npx prisma generate
npx prisma migrate deploy
npm run build
npm prune --omit=dev
pm2 restart bookmyclass-app --update-env
npm run verify:media-runtime

Notes:
- PM2 app name: bookmyclass-app
- Do not skip migrate deploy
- Do not deploy from main
- Runtime must end with production dependencies only (`npm prune --omit=dev` before PM2 restart/reload).
- Homesite HTML and screenshot assets are published only when explicitly enabled (`PUBLISH_HOMESITE=1`) in deploy automation.
- The default homesite document root is `/var/www/bookmyclass-homesite`.
- The deploy script creates `/var/www/bookmyclass-homesite/images/homesite`
  automatically and copies committed homesite images from
  `public/images/homesite`; no manual symlink or manual `mkdir` is required.
- Uploaded image media must resolve from persistent `/uploads/...` storage backed
  by `UPLOADS_DIR`, not from the release-local `public/` folder or `.next`.
  Canonical folders are `teachers`, `classes`, `learning`, and `products`.

---

## Stripe Catalog Sync (New Environments / Store Rollout)

Run `stripe:catalog:sync` when deploying to an environment that has not yet had
Stripe Products and Prices created, or when enabling the Store feature for the
first time. This is a one-time operator step per environment; subsequent
re-runs are safe (idempotent).

**Order of operations:**
1. Deploy the application and run `prisma migrate deploy` and seed.
2. Confirm `STRIPE_SECRET_KEY` is set to the correct key for the target environment.
3. Test mode (safe):
   ```
   npm run stripe:catalog:sync -- --scope=all --dry-run
   npm run stripe:catalog:sync -- --scope=all
   ```
4. Live mode (requires explicit flag):
   ```
   npm run stripe:catalog:sync -- --scope=all --dry-run
   npm run stripe:catalog:sync -- --scope=all --confirm-live
   npm run verify:catalog:production
   ```
5. Verify: store products now appear on `/store`; subscription prices resolve in checkout.

Before production deploy, run the dry-run first and record the result. If the
dry-run is clean, run the live sync only with explicit operator confirmation,
then run `npm run verify:catalog:production` again against the target database.

**Rollback:** The script only writes `stripePriceId` and `StripeSyncStatus.SYNCED`
to Price records. To roll back, reset those fields to `null`/`PENDING` in the DB.
The Stripe Products and Prices created are retained in Stripe (harmless; they can be
archived manually in the Stripe dashboard if needed).

---

## Server deploy command order

For UAT and Production, after checking out the release tag, use this command order:

```bash
git fetch --all --tags
git checkout vX.Y.Z
npm ci --include=dev
npx prisma generate
npx prisma migrate deploy
npm run build
npm prune --omit=dev
pm2 restart bookmyclass-app --update-env
npm run verify:media-runtime
```

### Command meaning

* `git fetch --all --tags` pulls latest remote refs and tags
* `git checkout vX.Y.Z` switches the server to the exact release version
* `npm ci --include=dev` installs lockfile dependencies including temporary build-time devDependencies
* `npx prisma migrate deploy` applies committed migrations to the target database
* `npx prisma generate` regenerates Prisma client artifacts for the checked out version
* `npm run build` builds the Next.js application
* `npm prune --omit=dev` removes devDependencies before runtime activation
* `pm2 restart bookmyclass-app --update-env` restarts the app with the current environment
* `npm run verify:media-runtime` checks persistent media storage and `/uploads/...` public path generation for all canonical image folders

### Rules

* Always deploy from a tag, never from `main`
* Always run `npm ci --include=dev` before build on UAT/Production
* Always run `npx prisma migrate deploy` before `npx prisma generate`
* Always run `npx prisma generate` before `npm run build`
* Always run `npm prune --omit=dev` after build and before PM2 restart/reload
* Always restart PM2 only after a successful build
* Never run `prisma migrate reset` or seed commands during normal UAT/production deploy
* Never use destructive database reset commands for UAT or Production catalog setup

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
- static homesite screenshot images return 200 from a real image URL such as
  `https://bookmyclass.app/images/homesite/<image>.jpg`; a 403 from the
  directory URL alone is not a failure because directory listing may be disabled

---

### 3. Observability Check

Verify:

- no immediate errors in logs (PM2)
- Sentry is receiving errors (if triggered)
- monitoring is green (Uptime Kuma)

---

### 4. Gift-Card Maintenance Confirmation

When a release includes gift-card maintenance cleanup:
- confirm `CRON_SECRET` is configured on the target environment
- run `npm run verify:gift-card-maintenance`
- confirm the operator has scheduled or manually run `GET /api/cron/gift-cards/maintenance`
- confirm cleanup reports `failedCount: 0`, or review `gift_card.reservation_cleanup_failed` events before enabling a schedule
- note: maintenance is controlled by route authentication and scheduler configuration; there is no active Store/Gift Card maintenance feature flag in the current runtime

Recommended scheduler setup:
- Endpoint: `GET /api/cron/gift-cards/maintenance`
- Header: `Authorization: Bearer $CRON_SECRET`
- Frequency: every 5 to 15 minutes
- External scheduler: create an HTTPS GET monitor in Uptime Kuma, Healthchecks,
  or cron with the bearer header; alert on non-2xx responses.
- Release evidence must include maintenance route verification, schedule
  configured, and the last successful run observed before launch.

---

### 5. Store Production Enablement Checklist

When deploying the Store and gift-card purchase features to production, the operator
must complete ALL of the following steps. The Store is always-on; there are no feature
flags â€” Stripe catalog sync and live price IDs are the gate.

**Stripe live prices â€” required before deployment:**
- [ ] All active Store merchandise prices have `stripeSyncStatus = SYNCED` and a live Stripe price ID (not a test ID).
- [ ] All active Store gift-card prices have `stripeSyncStatus = SYNCED` and a live Stripe price ID (not a test ID).
- [ ] `npm run stripe:catalog:sync -- --scope=all --dry-run` completed cleanly.
- [ ] `npm run verify:catalog:production` passed after catalog sync.
- [ ] No active store price has a test Stripe ID (`price_test_*`) in the production database.
- [ ] Stripe live mode key (`sk_live_*`) is configured in the production environment.

**Alert rules and maintenance:**
- [ ] Alert rules are configured for `gift_card.reservation_cleanup_failed` events.
- [ ] `CRON_SECRET` is configured in the production environment.
- [ ] `npm run verify:gift-card-maintenance` passed.
- [ ] Gift-card maintenance cron (`GET /api/cron/gift-cards/maintenance`) is scheduled or manually verified.
- [ ] Maintenance procedure is confirmed: operator knows how to disable maintenance cron and recover.

**Smoke tests (run after deployment):**
- [ ] `/store` renders active products.
- [ ] Gift-card purchase flow completes against live Stripe; issuance email delivered with code.
- [ ] Gift-card code redemption credits wallet balance.
- [ ] Health endpoint returns 200.
- [ ] Uploaded teacher, booking service, learning, and Store product images render from `/uploads/...` after deploy/restart.
- [ ] Static homesite screenshots render without a manual symlink.

**Canonical references:**
- `docs/40_02_environment_variables.md` â€” environment variable reference
- `src/lib/catalog/checkout-readiness.ts` â€” live/test Stripe ID validation
- `src/lib/store/store-admin-catalog-service.ts` â€” store catalog admin service

---

## Production Readiness Gate (MANDATORY)

Before deploying to production, run:

npm run ops:verify-readiness -- \
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
- Store production catalog readiness must pass (`npm run verify:catalog:production`)
- Gift-card maintenance verification must pass (`npm run verify:gift-card-maintenance`)
- Media runtime verification must pass when uploaded image media is in scope (`npm run verify:media-runtime`)
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
- .github/workflows/staging-release.yml
- .github/workflows/prod-release.yml
- scripts/ops-server-verify-readiness.sh
- docs/50_02_bookmyclass_server_setup_updated.md
- docs/50_13_uat_security_operator_runbook.md
- docs/30_03_security_testing_checklist.md



