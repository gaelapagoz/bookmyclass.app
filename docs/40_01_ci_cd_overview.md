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
- Manual production promotion workflow exists at `.github/workflows/prod-release.yml`.
- Production deployment remains explicit and operator-approved via GitHub Environment protection.
- Tag-based UAT release workflow references may still exist, but UAT is currently disabled/retired.
- Current release validation relies on CI, local targeted validation, and operator-approved production deployment.

## Canonical References
- `docs/00_02_deployment_baseline.md`
- `.github/workflows/ci.yml`
- `docs/50_02_bookmyclass_server_setup_updated.md`
