# E2E Environment Setup

This project uses a dedicated Playwright e2e environment isolated from local dev/test data.

## Environment File

Create `.env.e2e` from `.env.e2e.example`.

Required values:

- `DATABASE_URL` (must point to a dedicated e2e database)
- `AUTH_SECRET`
- `NEXTAUTH_SECRET`
- `APP_URL`
- `PORT` (recommended: `3100` to avoid conflicts with local dev server)
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `E2E_TEST_MODE=1`
- `E2E_TEST_SECRET`

Optional in deterministic e2e mode (`E2E_TEST_MODE=1`):

- `RESEND_API_KEY`
- `EMAIL_FROM`

Notes:

- In e2e mode, email delivery is provider-bypassed deterministically in the centralized email integration layer.
- Production still requires valid Resend delivery configuration and sender domain policy.

## E2E DB Lifecycle Commands

- `npm run db:e2e:migrate`: apply migrations on e2e DB
- `npm run db:e2e:seed`: deterministic e2e seed
- `npm run db:e2e:reset`: reset + seed e2e DB
- `npm run db:e2e:setup`: migrate + seed e2e DB

## Run E2E

- `npm run test:e2e`

## Test-Only Helpers

Enabled only when `E2E_TEST_MODE=1` and guarded by `x-e2e-test-secret`.

- `POST /api/test/e2e/verify-email`
- `POST /api/test/e2e/stripe/complete`

These helpers are intentionally test-only and return `404` outside e2e mode.

