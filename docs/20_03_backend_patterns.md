# Backend Patterns

Purpose: capture backend implementation patterns currently used in this repository.

## Request Handling Patterns
- Next.js route handlers for public/API endpoints (`src/app/api/*`).
- Server actions for admin/private mutations (`src/app/admin/(private)/actions.ts`).
- Service modules perform domain logic (`src/lib/*`).

## Data and Validation Patterns
- Prisma is the only data access layer (`src/lib/db.ts`, `prisma/schema.prisma`).
- Zod validation is used before mutations and auth credential parsing.
- Mutation paths are service-first and generally return typed/domain-shaped results.

## Auth and Access Patterns
- NextAuth credentials provider (`src/auth.ts`).
- Route/session guards:
  - `requireVerifiedUser` for protected customer flows.
  - `requireAdminSession` for admin flows.

## Payment and Email Integration Patterns
- Stripe integration wrapper: `src/lib/payments/stripe.ts`.
- Webhook verification + reconciliation in booking/subscription services.
- Resend email delivery centralized in `src/lib/email/resend-delivery.ts`.
- Real provider email delivery is production-only by default; non-production requires `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1`.

## Reliability Patterns
- Financial/entitlement flows use idempotency and unique constraints in schema/service logic.
- Health endpoint verifies DB readiness (`src/app/api/health/route.ts`).

## Known Constraints
- No queue/worker subsystem is present in repo.
- In-memory rate-limiter utility is process-local (`src/lib/security/rate-limit.ts`).
