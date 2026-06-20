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
- Waitlist join, cancel, and auto-promotion for collective classes.
- Dashboard booking, subscription, wallet, and profile paths.
- Kiosk and dashboard self check-in flows under the existing attendance model.
- Subscription checkout + billing portal.
- Store customer flows for merchandise and gift cards.
- Online learning catalog/admin surfaces are present in the current application footprint.
- Admin operations for catalog, sessions, users, subscriptions, learning, marketing, inbox, store-adjacent catalog, and related commerce management.
- Admin-only `Automations` placeholder page exists at `/admin/automations` (informational only, no configuration engine).
- Manual session roster operations remain service-enforced: admin can add/remove attendees and may use an audited no-credit override; teacher can manage only assigned sessions and remains eligibility-only.

## Not Fully Active / Not Yet Introduced
- No-show runtime operations remain modeled but not fully confirmed as active end-to-end.
- Teacher workflow coverage/enforcement is not fully confirmed across all operational routes.
- Loyalty points are not yet an active runtime capability at the time of this document update; the loyalty roadmap and scaffolds define the target state but not current production reality.
- The approved loyalty target keeps mutation ownership in future `src/lib/loyalty/*` services, with checkout, webhook, cart, dashboard, and admin layers limited to orchestration and read models.
- Any future combined wallet UI is read-model only; loyalty and gift-card mutation invariants remain separate.

## Canonical References
- `docs/00_01_system_baseline.md`
- `docs/00_03_known_non_goals.md`
- `docs/00_02_deployment_baseline.md`
