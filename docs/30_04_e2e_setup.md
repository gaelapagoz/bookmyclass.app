# E2E Environment Setup

This project uses a dedicated Playwright e2e environment isolated from local dev/test data.

## Environment File

Create `.env.e2e` from `.env.e2e.example`.

Required values:

- `DATABASE_URL` (must point to a dedicated e2e database)
- `AUTH_SECRET`
- `APP_URL`
- `PORT` (recommended: `3100` to avoid conflicts with local dev server)
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `E2E_TEST_MODE=1`
- `E2E_TEST_SECRET`
- all `STRIPE_PRICE_ID_STORE_*` values from `.env.e2e.example`

Optional in deterministic e2e mode (`E2E_TEST_MODE=1`):

- `RESEND_API_KEY`
- `EMAIL_FROM`

Notes:

- In e2e mode, email delivery is provider-bypassed deterministically in the centralized email integration layer.
- The Playwright runner starts the built app (`next start`) with an internal E2E-only runtime override so helper routes stay available without `next dev` recompilation churn.
- Production still requires valid Resend delivery configuration and sender domain policy.
- Store and Gift Card flows are part of the canonical E2E runtime and are not gated by Store rollout feature flags.

## E2E DB Lifecycle Commands

- `npm run db:e2e:migrate`: apply migrations on e2e DB
- `npm run db:e2e:seed`: deterministic e2e seed
- `npm run db:e2e:reset`: reset + seed e2e DB
- `npm run db:e2e:setup`: migrate + seed e2e DB

## Run E2E

- `npm run qa:e2e:coverage`: validate matrix coverage tags before running the expensive browser suite
- `npm run test:e2e`
- `npm run test:e2e:store`: local Store-only subset convenience command

`qa:e2e:coverage` scans `test/e2e/**/*.spec.ts` for `@covers` and `@covers-partial`
tags and validates them against `qa/e2e-coverage-matrix.json`. Unknown or malformed
tags fail the command.

Store coverage is release-valid only when the canonical `npm run test:e2e` suite
has run successfully. The Store-only subset is useful during development but is
not a substitute for full E2E evidence.

## Test-Only Helpers

Enabled only when `E2E_TEST_MODE=1` and guarded by `x-e2e-test-secret`.

- `POST /api/test/e2e/verify-email`
- `POST /api/test/e2e/stripe/complete`

These helpers are intentionally test-only and return `404` outside e2e mode.

