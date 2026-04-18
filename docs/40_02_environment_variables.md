# Environment Variables

Purpose: define environment-variable expectations by runtime context using repository truth.

## Production/Core Runtime (Code-Required)
- `DATABASE_URL`
- `AUTH_SECRET`
- `APP_URL`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Email Delivery
- Provider send path uses:
  - `RESEND_API_KEY`
  - `EMAIL_FROM`
- Homesite contact form send path also requires:
  - `CONTACT_FORM_TO_EMAIL`
  - Expected configured value: `gaelapagoz@gmail.com`
- In production, sender policy is enforced in code: sender must use verified `@bookmyclass.app` domain when provider delivery is used.

## Test / E2E Runtime
- Deterministic email bypass is enabled by `NODE_ENV=test` or `E2E_TEST_MODE=1`.
- Test/e2e runs do not require real provider delivery to be deterministic.
- E2E helper security expects `E2E_TEST_SECRET`.

## Observability (Optional/Environment-Specific)
- Sentry variables are optional and used when configured (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, environment/release metadata vars).

## Seed/Test Helpers
- `.env.test.example` defines integration-test baseline.
- Seed currently expects Stripe price IDs for seeded catalog mapping.

## Canonical References
- `docs/00_01_system_baseline.md`
- `docs/00_02_deployment_baseline.md`
- `.github/workflows/ci.yml`
- `src/lib/email/resend-delivery.ts`
