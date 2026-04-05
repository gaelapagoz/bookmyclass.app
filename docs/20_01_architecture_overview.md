# Architecture Overview

Purpose: describe the current application architecture from repository evidence.

## Runtime Shape
- Next.js App Router monolith (`src/app`) with server components, client components, route handlers, and server actions.
- TypeScript + React runtime (`package.json`).
- Prisma + PostgreSQL persistence (`prisma/schema.prisma`, `src/lib/db.ts`).

## Main Layers
- Presentation/routes: `src/app/*`, `src/components/*`.
- Domain/application services: `src/lib/*`.
- Data model and migration history: `prisma/schema.prisma`, `prisma/migrations/*`.
- Tests: `test/unit`, `test/integration`, `test/ui`, `test/e2e`.

## Active Product Flows (Confirmed)
- Sign up, email verification, sign in, password reset.
- Booking draft, payment-option selection, Stripe checkout, confirmation/reconciliation.
- Subscription checkout + billing portal.
- Dashboard booking/subscription/profile paths.
- Admin operations for catalog, sessions, users, subscriptions, learning, marketing, inbox.

## Known Non-Goals / Not Fully Active
- Waitlist auto-promotion and no-show operations are modeled but not confirmed as fully active runtime flows.
- Teacher workflow coverage/enforcement is not fully confirmed.

## Canonical References
- `docs/00_01_system_baseline.md`
- `docs/00_03_known_non_goals.md`
- `docs/00_02_deployment_baseline.md`
