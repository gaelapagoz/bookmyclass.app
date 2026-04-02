# Studio SaaS Platform (Booking + Subscription)

## Project Overview
This repository contains a Next.js + Prisma SaaS for a Fitness Studio App.
Primary users are:
- Clients booking classes and purchasing plans/subscriptions
- Admins operating catalog, schedules, users, subscriptions, learning content, and marketing campaigns

This README is grounded in current code and config (not roadmap).

## What The App Does
- Public marketing pages (`/`, `/about/*`, `/book-a-class`, `/subscription`, `/learning`)
- Email/password authentication with email verification and password reset
- Class booking flow with:
  - booking draft creation
  - payment option selection (existing plan, new plan purchase, or single-session where available)
  - Stripe Checkout for paid paths
- Subscription/product catalog checkout from `/subscription`
- Stripe webhook finalization + return-page reconciliation fallback
- Protected client dashboard (`/dashboard/*`) for bookings, membership, profile/security
- Admin portal (`/admin/*`) for operational management
- Online learning catalog (video playback requires sign-in)

## Core Features
- Auth + account lifecycle:
  - Sign up, email verification, sign in, stale session recovery, forgot/reset password
- Booking domain:
  - Public class catalog and availability APIs
  - Pending booking drafts with validation and rate limiting
  - Payment-option recommendation and selection logic
  - Confirmation pages for plan-based and Stripe-based booking outcomes
- Subscription/checkout:
  - Product + Price driven catalog (`Product`/`Price`, not separate plan model)
  - Stripe Checkout session creation
  - Stripe billing portal link (when customer exists)
- Admin operations:
  - Classes, sessions, plans/products, subscriptions, users
  - Learning programs/videos CRUD
  - Inbox/client messages (with spam heuristics + rate limit in service layer)
  - Agenda PDF upload and public document switching
  - Marketing campaign drafting/sending, tracking, and unsubscribe endpoints
- Learning:
  - Programs and courses loaded from DB
  - Auth-gated video playback on course detail pages
- Observability:
  - Sentry integration (server, edge, client), production-enabled
  - Health endpoint at `/api/health` with DB readiness check

## Practical Architecture
- Framework: Next.js App Router (`src/app`)
- Auth: Auth.js (NextAuth v5 beta) with Prisma adapter and credentials provider
- Data layer: Prisma + PostgreSQL (`src/lib/db.ts` with `@prisma/adapter-pg`)
- Domain/services: server-side logic under `src/lib/*` (booking, subscription, auth, admin, marketing, learning)
- UI: server components + client components in `src/components`
- Admin mutations: server actions in `src/app/admin/(private)/actions.ts`
- Payments: Stripe via `src/lib/payments/stripe.ts` and webhook handling in `src/lib/public-booking/stripe-webhook-service.ts`

## Key User Flows (Current)

### Authentication
- Public sign-up creates pending registration and sends verification email.
- Sign-in blocks unverified/inactive users.
- Verification page supports token verification and resend.
- Forgot/reset password flows are implemented via tokenized email reset.

### Booking
1. User browses services (`/book-a-class`) and service detail/slots.
2. User creates a booking draft (`POST /api/bookings/draft`) with consent requirements and ownership checks.
3. User fetches payment options and applies selection:
   - `GET /api/bookings/[bookingId]/payment-options`
   - `POST /api/bookings/[bookingId]/apply-plan`
4. If paid path selected, user starts checkout (`POST /api/checkout/session`).
5. Confirmation occurs via Stripe webhook, with return-page reconciliation fallback on success page.

### Subscription / Checkout
1. Public subscription page loads active checkout-enabled catalog products.
2. Authenticated user starts checkout (`POST /api/subscription/checkout`).
3. Stripe webhook finalizes payment/order and ownership.
4. Success page can trigger reconciliation by `session_id`.
5. Billing portal available via `POST /api/subscription/portal`.

### Admin Operations
- Admin auth entry at `/admin`, private routes under `/admin/(private)/*` guarded by `requireAdminSession`.
- Admin service layer supports class/session/user/product(subscription-offering)/subscription operations.
- Admin can manage learning content and marketing campaigns from private admin pages/actions.

### Online Learning
- Public learning listing and course pages are available.
- Video iframe playback is gated by authentication only (sign-in required).

## Tech Stack
- Next.js 16
- React 19
- TypeScript 5
- Prisma 7 + PostgreSQL 16
- Auth.js / NextAuth v5 beta
- Stripe SDK
- Sentry (`@sentry/nextjs`)
- Zod validation
- Vitest + Testing Library
- Playwright (mobile Chromium project)

## Local Setup
1. Install dependencies:
```bash
npm ci
```

2. Start PostgreSQL (local default):
```bash
docker compose up -d postgres
```

3. Create env file for app runtime (no `.env.example` is currently committed; use the Environment Variables section below).

4. Generate Prisma client and apply migrations:
```bash
npx prisma generate
npx prisma migrate deploy
```

5. (Optional but common) Seed data:
```bash
npm run prisma:seed
```

6. Start app:
```bash
npm run dev
```

## Environment Variables

### Required for core app runtime
- `DATABASE_URL`
- `AUTH_SECRET`
- `APP_URL`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Required for full auth email flows (verification/reset)
- `RESEND_API_KEY`
- `EMAIL_FROM`

### Optional / feature-specific
- `OPENAI_API_KEY` (marketing AI assist)
- `OPENAI_MARKETING_MODEL` (default falls back to `gpt-4.1-mini`)
- `MARKETING_TRACKING_SECRET` (fallback chain includes `NEXTAUTH_SECRET`)
- `AUTH_DEBUG_PASSWORD_RESET` (non-production debug behavior)

### Optional observability (Sentry)
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `NEXT_PUBLIC_SENTRY_RELEASE`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`
- `CI`
- `VERCEL_GIT_COMMIT_SHA`
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`
- `GIT_SHA`

### Seed/test specific
- `.env.test` is required for integration DB setup (`.env.test.example` is provided).
- Prisma seed currently validates additional Stripe price env vars:
  - `STRIPE_PRICE_ID_COLLECTIVE_DROP_IN`
  - `STRIPE_PRICE_ID_COLLECTIVE_5_PACK`
  - `STRIPE_PRICE_ID_COLLECTIVE_10_PACK`
  - `STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE`
  - `STRIPE_PRICE_ID_PRIVATE_5_PACK`
  - `STRIPE_PRICE_ID_PRIVATE_10_PACK`
- Optional seed helper vars:
  - `LEARNING_SEED_JSON_PATH`
  - `DASHBOARD_TREND_AS_OF_DATE`

## Database / Prisma Notes
- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/*`
- Seed: `prisma/seed.ts`
- Prisma config: `prisma.config.ts`

Useful commands:
```bash
npm run prisma:generate
npm run prisma:seed
npm run db:reset
```

Test DB helpers:
```bash
npm run db:test:setup
npm run db:test:reset
```

Important:
- Integration test setup enforces that test DB name contains `test`.
- `db:reset` and seed scripts are destructive to local DB data.

## Testing And Validation

Run tests:
```bash
npm test -- --run
npm run test:e2e
```

Build/lint checks:
```bash
npm run lint
npm run build
```

Additional verification scripts:
```bash
npm run db:verify:dashboard-seed
npm run db:verify:dashboard-trend-seed
```

## Operational Notes / Monitoring
- App readiness endpoint: `GET /api/health` (returns `200` with DB up, `503` when DB check fails).
- Sentry is wired for server, edge, and client, enabled in production mode.
- Production runbooks and monitoring docs are in `docs/`:
  - `docs/20_monitoring_system_guide.md`
  - `docs/05_monitoring_alerting_setup.md`
  - `docs/06_monitoring_netdata_setup.md`
  - `docs/07_pm2_autostart_setup.md`
  - `docs/21_remote_access_guide.md`
- Release-readiness helper script:
```bash
npm run ops:verify-production-readiness -- \
  --confirm-kuma \
  --confirm-backup-heartbeat \
  --confirm-local-healthcheck \
  --confirm-latest-backup \
  --confirm-restore-proof
```

## Current Beta Scope
- Public discovery + class browsing
- Authenticated customer booking flow with plan and Stripe payment paths
- Product/subscription checkout flow from `/subscription`
- Customer dashboard (bookings/membership/profile/security)
- Admin operations for catalog/scheduling/users/subscriptions/learning/marketing
- Basic operational readiness: health endpoint + Sentry + documented runbooks

## Known Limitations / Non-Goals (Current Repo State)
- No canonical `.env.example` for full runtime is committed yet (only `.env.test.example` exists).
- Marketing send path can mark sends as successful when `RESEND_API_KEY` is missing (provider send is skipped by design in current implementation).
- Learning video access is auth-gated but not entitlement/subscription-gated.
- E2E coverage is limited (single Playwright mobile spec currently committed).
- Some operations docs include environment-specific hostnames/IPs and should be treated as runbook references, not portable defaults.
- This README does not document roadmap features that are not present in current code.

## Repository Structure (Practical)
```text
src/
  app/            # routes (public, protected, admin, API, auth, marketing tracking)
  components/     # UI components
  lib/            # domain/application services (auth, booking, payments, admin, etc.)
  server/         # server-side modules
  types/          # type augmentations
prisma/
  schema.prisma
  migrations/
  seed.ts
test/
  unit/
  integration/
  ui/
  e2e/
  manual/
docs/             # business/domain/testing/ops runbooks
scripts/          # maintenance and verification scripts
```

## Support / Ownership Notes
- Formal `CODEOWNERS` is not configured in `.github` at this time.
- For implementation guardrails, follow:
  - `docs/business-rules.md`
  - `docs/codex-rulebook.md`
  - `docs/domain-rules.md`
  - `docs/subscription-domain-rules.md`
- For test expectations, use:
  - `docs/testing-rulebook.md`
  - `docs/testing-checklist.md`
