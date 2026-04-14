# CI/CD Overview

Purpose: summarize the current CI/CD posture from repository evidence.

## Current Pipeline
- Single workflow: `.github/workflows/ci.yml`.
- Two jobs:
  - `regression`
  - `e2e` (depends on `regression`).

## `regression` Job (Current)
- Uses Postgres service (`studio_test`).
- Runs: dependency install, Prisma generate, build, full Vitest run, Prisma migrate status.

## `e2e` Job (Current)
- Uses separate Postgres service (`studio_e2e_test`).
- Runs deterministic e2e DB reset (`npm run db:e2e:reset`) then Playwright suite (`npm run test:e2e:ci`).
- Uses `E2E_TEST_SECRET` from GitHub repository secrets.
- Uploads Playwright artifacts (`playwright-report/`, `test-results/`) on failure.

## Deployment Automation Status
- No automated production deploy job exists in this repository.
- Deployment is documented as manual runbook-driven process.
- Tag-based UAT release workflow exists at `.github/workflows/uat-release.yml` and runs deployed-UAT gates.

## Canonical References
- `docs/00_02_deployment_baseline.md`
- `.github/workflows/ci.yml`
- `docs/50_02_bookmyclass_server_setup_updated.md`
