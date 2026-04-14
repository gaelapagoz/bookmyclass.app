# UAT Release E2E Checks

## Purpose

This suite validates a deployed UAT release tag after smoke checks pass.

It is intentionally narrow:
- release-blocking
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

Current release scope:
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

In `.github/workflows/uat-release.yml`, release-tag sequence is:
1. `ci`
2. `deploy_uat`
3. `smoke_uat`
4. `e2e_uat`

If `e2e_uat` fails, the workflow fails and Playwright artifacts are uploaded.
