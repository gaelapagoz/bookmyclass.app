# Auth Security

Purpose: document the current authentication and auth-related security controls.

## Auth Stack
- NextAuth (Auth.js) with Prisma adapter and credentials provider (`src/auth.ts`).
- Session strategy: JWT.
- Auth secret: `AUTH_SECRET`.

## Account Security Controls
- Public users require active status and verified email for customer login paths.
- Password hashing/verification is enforced in auth flow.
- Password reset uses token hashing, one-time usage semantics, and expiry checks.
- Email verification and email-change verification use tokenized flows.

## Admin Login Protection
- Admin login abuse counters are persisted in DB (`AdminLoginAbuseCounter`).
- CAPTCHA enforcement supports Cloudflare Turnstile when env keys are configured.
- Turnstile verification occurs server-side against Cloudflare siteverify endpoint.

## Known Constraints
- MFA is not currently implemented in repository code.

## Canonical References
- `src/auth.ts`
- `src/lib/auth/credentials-authorize.ts`
- `src/lib/auth/password-service.ts`
- `src/lib/auth/user-identity-service.ts`
- `src/lib/auth/admin-login-captcha.ts`
- `prisma/schema.prisma`
