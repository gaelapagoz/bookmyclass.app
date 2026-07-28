# Email Resend Integration

Purpose: document current email delivery integration and test/e2e behavior.

## Integration Boundary
- Central email sender: `src/lib/email/resend-delivery.ts`.
- Auth identity and password services call this delivery module.
- Marketing send path also uses this delivery module.

## Deterministic Test/E2E Behavior
- Delivery bypass mode is enabled when `NODE_ENV=test` or `E2E_TEST_MODE=1`.
- In deterministic mode, emails are captured in in-memory test outbox and provider send is skipped.

## Production Safety Behavior
- Provider send path requires `RESEND_API_KEY`.
- In production provider-send path, `EMAIL_FROM` must use verified `@bookmyclass.app` sender domain.
- Primary operator control for automation-backed email is Admin -> Automations, backed by `EmailTemplate.isActive`.
- Newly provisioned canonical automation templates are active by default.
- Clean development, staging/performance, and E2E seeds finish with canonical automation templates active.
- Administrators can pause individual automations afterward; normal runtime reconciliation and production-safe upsert seeds preserve existing Active/Paused choices.
- Paused automation templates are not enqueued for delivery, and already-leased paused events do not call Resend.
- Outside production, provider delivery is still suppressed by default even when `RESEND_API_KEY` is configured.
- `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1` remains a secondary safety-net override for direct email paths that are outside Automations.
- This secondary default-safe behavior applies to staging/UAT/performance/k6 runtimes as well as local non-test runs.

## Main Callers
- Automation-backed and controlled from Admin -> Automations:
  - Signup/email verification identity flows.
  - Password reset flows.
  - Waitlist/booking lifecycle notifications.
  - Payment/store/gift-card confirmation flows.
- Direct send paths outside Automations:
  - Marketing campaign sends/tests.
  - Homesite contact form API flow (`POST /api/contact-form`) sends to `CONTACT_FORM_TO_EMAIL`.

## Canonical References
- `src/lib/email/resend-delivery.ts`
- `src/lib/auth/user-identity-service.ts`
- `src/lib/auth/password-service.ts`
- `src/lib/marketing/marketing-delivery.ts`
