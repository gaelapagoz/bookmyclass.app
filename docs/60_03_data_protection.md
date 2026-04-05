# Data Protection

Purpose: document current data-protection behavior visible in code.

## Data Handling Controls
- Password reset and verification tokens are stored as hashes, not plaintext tokens.
- Sensitive events sent to Sentry are sanitized through centralized sanitizer.
- `sendDefaultPii` is disabled in Sentry config.

## Data Domains in Scope
- Identity and sessions.
- Booking/subscription/payment records.
- Marketing recipient/tracking records.
- Contact/inbox messages.

## Logging and Exposure Controls
- Health endpoint exposes readiness status only.
- Integration errors are logged with contextual metadata in service paths.

## Known Constraints
- This repository does not include a formal legal/privacy policy document or data-retention policy file.
- Compliance controls beyond implemented technical guards require operator/legal policy confirmation.

## Canonical References
- `src/lib/auth/password-service.ts`
- `src/lib/auth/user-identity-service.ts`
- `src/lib/observability/sentry-sanitize.ts`
- `sentry.server.config.ts`
- `src/app/api/health/route.ts`
