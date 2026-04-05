# Secret Management

Purpose: define current secret-management expectations from code and CI configuration.

## Secrets Used by Application/CI
- Auth/session: `AUTH_SECRET`.
- Database: `DATABASE_URL`.
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- Email provider: `RESEND_API_KEY`, `EMAIL_FROM`.
- E2E guarded helper: `E2E_TEST_SECRET`.
- Optional observability: Sentry DSN/token/release metadata variables.

## Current CI Handling
- `E2E_TEST_SECRET` is consumed from GitHub repository secrets in e2e job.
- Other CI runtime values are currently set in workflow environment for deterministic CI/e2e execution.

## Runtime Policy Notes
- Production sender-domain policy is enforced when provider email delivery is active.
- Deterministic test/e2e mode bypasses provider send and should not depend on production email secret validity.

## Operational Guidance
- Keep production secrets out of repository.
- Rotate secrets operationally via platform secret stores and host env updates.

## Canonical References
- `.github/workflows/ci.yml`
- `src/lib/email/resend-delivery.ts`
- `docs/40_02_environment_variables.md`
