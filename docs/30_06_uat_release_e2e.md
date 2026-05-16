# UAT Release E2E Checks

## Purpose

This suite validates a deployed UAT release tag when the operator manually
triggers UAT release validation. Current release validation uses local/CI E2E
plus operator-run UAT/manual release validation.

It is intentionally narrow:
- operator-triggered
- non-destructive
- stable against deployed UAT
- separate from local/dev e2e coverage

## Scope

Test location:
- `test/e2e/uat/release-uat.spec.ts`

Playwright config:
- `playwright.uat.config.ts`

NPM command:
- `npm run test:e2e:uat`

Release scope:
1. Public home page loads
2. Public `/book-a-class` page loads
3. Public `/subscription` page loads
4. Public `/sign-in` page loads
5. Sign in with seeded UAT release user from secrets
6. Authenticated dashboard loads
7. Authenticated `/dashboard/profile` page loads

Out of scope in this layer:
- admin CRUD and admin mutation validation
- destructive setup or data mutation flows
- payment completion and Stripe end-to-end completion
- broad regression coverage

## Environment

Required:
- `UAT_BASE_URL`
- `UAT_E2E_EMAIL`
- `UAT_E2E_PASSWORD`

`BASE_URL` is supported and takes precedence when explicitly set.

## GitHub Actions order

When the operator runs UAT validation, `.github/workflows/staging-release.yml`
release-tag sequence is:
1. `regression`
2. `e2e`
3. `deploy_staging`
4. `smoke_staging`
5. `e2e_staging`
6. `k6_smoke_staging`
7. `zap_staging`

If `e2e_staging` fails, the workflow fails and Playwright artifacts are uploaded.
These jobs are operator-run validation steps and are not automatic release
blockers.

Pre-deploy CI e2e and deployed-UAT release e2e are distinct:
- `e2e` in `.github/workflows/ci.yml` is pre-deploy CI e2e
- `e2e_staging` in `.github/workflows/staging-release.yml` is post-deploy UAT/staging release e2e
