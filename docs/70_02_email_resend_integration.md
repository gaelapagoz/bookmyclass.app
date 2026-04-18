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

## Main Callers
- Signup/email verification identity flows.
- Password reset flows.
- Marketing campaign sends/tests.
- Homesite contact form API flow (`POST /api/contact-form`) sends to `CONTACT_FORM_TO_EMAIL`.

## Canonical References
- `src/lib/email/resend-delivery.ts`
- `src/lib/auth/user-identity-service.ts`
- `src/lib/auth/password-service.ts`
- `src/lib/marketing/marketing-delivery.ts`
