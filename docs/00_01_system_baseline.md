
# System Baseline

## Canonical Source Priority
- Priority 1: this file (`00_01_system_baseline.md`) for architecture/current-state truth and active capability status.
- Priority 2: [`00_02_deployment_baseline.md`](/c:/Dev/studio.saas.platform/docs/00_02_deployment_baseline.md) for canonical deployment/runtime facts.
- Priority 3: `10_01_business_rules.md`, `10_02_domain_rules.md`, `10_03_subscription_domain_rules.md` for business/modeling truth.
- Priority 4: `20_01_architecture_overview.md`, `20_02_service_boundaries.md`, `20_03_backend_patterns.md`, `20_04_frontend_guidelines.md` for engineering architecture guidance.
- Priority 5: `90_01_codex_rulebook.md` for implementation behavior constraints.
- Priority 6: `30_01_testing_rulebook.md` and `30_02_testing_checklist.md` for testing expectations.
- Priority 7: `40_*`, `60_*`, `70_*`, and setup/runbook files (`50_01` through `50_11`) as operational and integration references.

## Documentation Groups
- `00_*`: Foundations and canonical baselines.
- `10_*`: Product and domain rules.
- `20_*`: Engineering standards and implementation guidance.
- `30_*`: Testing standards and inventory.
- `40_*`: Deploy, infrastructure, and operations references.
- `50_*`: Operational setup guides and runbooks.
- `60_*`: Security and compliance references.
- `70_*`: External integration references.
- `90_*`: AI workflow and implementation guardrails.

If a setup/runbook file conflicts with this baseline or deployment baseline, treat the runbook value as non-canonical and request operator confirmation.

## Canonical Production Facts
- Canonical runtime/deployment fact sheet: [`00_02_deployment_baseline.md`](/c:/Dev/studio.saas.platform/docs/00_02_deployment_baseline.md).
- This file remains the source for architecture and active-flow status, while deployment baseline is the source for live runtime values (host/IP, container naming, ports, cron, secrets naming).
- Known modeled-but-not-fully-active flows are tracked in [`00_03_known_non_goals.md`](/c:/Dev/studio.saas.platform/docs/00_03_known_non_goals.md).

Evidence label legend used in this file:
- `Confirmed from repo`: directly evidenced in code/config/scripts committed in this repository.
- `Confirmed from deployment/config artifacts`: evidenced in committed operational/deployment documents or scripts.
- `Operator-stated / external to repo`: stated in docs/runbooks about live infrastructure; cannot be technically proven as currently-live from code alone.
- `Missing / not verifiable`: not recoverable with confidence from repository contents.

## 1. Purpose of the application
- Delivery objective:
  - Production launch readiness with stable, correct, and operationally safe real-user flows.
  - Evidence status: Repository objective/alignment statement.
- Product scope:
  - Booking + subscription SaaS for a yoga/pilates/fitness studio, with public discovery pages, authenticated customer flows, and an admin back office.
  - Evidence status: Confirmed from repo (`README.md`, `src/app`, `src/lib`, `prisma/schema.prisma`).
- Who uses it:
  - Clients (`CLIENT`) for booking, checkout, membership, profile/security.
  - Admin users (`ADMIN`, `MASTER_ADMIN`) for operations.
  - Teacher role exists (`TEACHER`) but current app usage appears limited.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`, `src/lib/auth/require-auth.ts`, `src/app/admin/*`, `src/app/teacher/*`).
- Current scope implemented:
  - Public class catalogue + availability APIs.
  - Booking draft -> payment-option selection -> Stripe checkout/confirmation.
  - Product/subscription checkout from `/subscription`.
  - Customer dashboard (bookings/membership/profile/password/email change).
  - Admin CRUD/ops for classes/sessions/plans/subscriptions/users/learning/marketing/inbox.
  - Evidence status: Confirmed from repo (`src/app`, `src/lib`).

## 2. Functional specification
- Main user-facing capabilities:
  - Public browsing: home/about/book-a-class/subscription/learning.
  - Authenticated customer flows: booking + payment + membership management.
  - Evidence status: Confirmed from repo (`src/app/(public)/*`, `src/app/(protected)/*`, `src/components/*`).
- Booking flows:
  - Service discovery via `/api/categories`, `/api/services`, `/api/services/[slug]/*`.
  - Draft creation via `POST /api/bookings/draft`.
  - Payment options via `GET /api/bookings/[bookingId]/payment-options` and `POST /api/bookings/[bookingId]/apply-plan`.
  - Checkout via `POST /api/checkout/session`.
  - Success reconciliation on booking payment success page.
  - Evidence status: Confirmed from repo (`src/app/api/services/*`, `src/app/api/bookings/*`, `src/app/api/checkout/session/route.ts`, `src/lib/public-booking/*`).
- Subscription/billing flows:
  - Catalog products from Product+Price.
  - Checkout via `POST /api/subscription/checkout`.
  - Billing portal via `POST /api/subscription/portal`.
  - Success reconciliation via `/subscription/success`.
  - Evidence status: Confirmed from repo (`src/app/api/subscription/*`, `src/lib/subscription/*`, `src/lib/public-booking/checkout-service.ts`).
- Admin capabilities:
  - Server actions for classes/sessions/plans/users/subscriptions/learning/marketing/inbox/agenda.
  - Admin calendar session cards show active waitlist counts for operational visibility (read-only).
  - Admin session detail supports manual attendee add/remove with server-side eligibility enforcement (eligible credit or qualifying subscription required).
  - Admin sidebar includes an `Automations` placeholder page at `/admin/automations`; operational automations are not yet configurable from UI.
  - Evidence status: Confirmed from repo (`src/app/admin/(private)/actions.ts`, `src/lib/admin/admin-service.ts`, `src/lib/navigation/admin-nav.ts`, `src/app/admin/(private)/automations/page.tsx`, `src/lib/marketing/*`).
- Authentication/account flows:
  - Credentials auth, pending registration + verification, verification resend, password reset, profile update, password change, email change verification.
  - Evidence status: Confirmed from repo (`src/auth.ts`, `src/lib/auth/*`, `src/app/(public)/sign-*.tsx`, `src/app/(public)/verify-email/page.tsx`, `src/app/(public)/forgot-password/page.tsx`, `src/app/(public)/reset-password/page.tsx`).
- Contact/support/public flows:
  - Public contact form persists unified client messages with spam/rate-limit checks; admin inbox supports review/status updates.
  - Homesite static contact form posts to `/api/contact-form` and sends email through Resend without writing to admin inbox.
  - Evidence status: Confirmed from repo (`src/app/(public)/page.tsx`, `src/lib/client-messages/client-message-service.ts`, `src/app/admin/(private)/inbox/page.tsx`, `homesite/index.html`, `src/app/api/contact-form/route.ts`, `src/lib/contact-form/contact-form-service.ts`).
- Capability status summary:
  - Confirmed: booking draft/payment/checkout, subscription checkout, admin operations, auth flows, contact/inbox, attendance self check-in (dashboard + kiosk), staff attendance finalization.
  - Confirmed: admin and teacher session calendar surfaces include active waitlist count visibility (read-only, no manual controls).
  - Confirmed: teacher own-session roster management is enforced server-side; teacher add/remove is restricted to assigned sessions and still requires eligible credit or qualifying subscription.
  - Inferred: teacher operational workflows (UI placeholder suggests planned expansion).
  - Confirmed: waitlist join/cancel + auto-promotion workflow for collective classes.
  - Confirmed: waitlist feature scope for current release includes runtime eligibility-aware promotion, client join/cancel UX, and admin/teacher visibility; no manual waitlist controls are exposed.
  - Evidence status: Confirmed/Inferred/Missing based on `src` usage.

## 3. Roles and access model
- Roles in code:
  - `MASTER_ADMIN`, `ADMIN`, `TEACHER`, `CLIENT`.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`).
- Permission boundaries:
  - Admin private area gated by `requireAdminSession` (`ADMIN`/`MASTER_ADMIN`).
  - Customer protected area gated by `requireVerifiedUser`.
  - Evidence status: Confirmed from repo (`src/lib/auth/require-auth.ts`, `src/app/admin/(private)/layout.tsx`, `src/app/(protected)/layout.tsx`).
- Admin/MasterAdmin behavior:
  - Shared route/admin access checks use `isAdminRole`.
  - Privileged `MASTER_ADMIN` assignment/management is enforced server-side in admin user create/update flows.
  - Evidence status: Confirmed from repo (`src/lib/auth/admin-access.ts`, `src/lib/admin/admin-service.ts`, `src/app/admin/(private)/actions.ts`).
- Role escalation protections:
  - Admin session required for admin mutation paths.
  - `MASTER_ADMIN` assignment/management is protected server-side: `ADMIN` actors are blocked and `MASTER_ADMIN` is required for privileged role operations, with UI defense-in-depth reflecting that boundary.
  - Evidence status: Confirmed from repo (`src/app/admin/(private)/actions.ts`, `src/lib/admin/admin-service.ts`, `src/app/admin/(private)/users/new/page.tsx`, `src/app/admin/(private)/users/[id]/edit/page.tsx`).

## 4. Architecture overview
- High-level architecture:
  - Next.js App Router monolith with server components, client components, route handlers, and server actions.
  - Domain logic grouped under `src/lib/*`.
  - Prisma/PostgreSQL persistence layer.
  - Evidence status: Confirmed from repo (`src/app`, `src/lib`, `src/lib/db.ts`, `prisma/schema.prisma`).
- Frontend framework/runtime:
  - Next.js `16.2.0`, React `19.2.4`, TypeScript.
  - Evidence status: Confirmed from repo (`package.json`).
- Backend patterns:
  - API route handlers for app/public endpoints.
  - Server actions for admin/dashboard mutations.
  - Service modules for domain/business logic.
  - Evidence status: Confirmed from repo (`src/app/api/*`, `src/app/admin/(private)/actions.ts`, `src/lib/*`).
- Data access pattern:
  - Prisma singleton using `@prisma/adapter-pg`.
  - Evidence status: Confirmed from repo (`src/lib/db.ts`).
  - External integrations:
  - Stripe, Resend, Sentry, PostgreSQL.
  - Evidence status: Confirmed from repo (`package.json`, `src/lib/payments/stripe.ts`, `src/lib/auth/*`, `src/lib/marketing/*`, `instrumentation*.ts`, `sentry.*.config.ts`).
- Source-of-truth decisions:
  - Catalog is Product+Price driven.
  - Webhook/reconciliation updates local payment/order/entitlement/subscription truth.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`, `src/lib/subscription/subscription-products.ts`, `src/lib/public-booking/stripe-webhook-service.ts`).

## 5. Main request/data flows
- Sign up / sign in:
  1. User submits sign-up form.
  2. System creates/updates `PendingUserRegistration` and sends verification email.
  3. Verification token confirms pending registration and creates/activates user.
  4. Credentials sign-in checks status/password/email verification (non-admin), then session is created.
  - Flow status: Confirmed.
  - Evidence status: Confirmed from repo (`src/app/(public)/sign-up/page.tsx`, `src/lib/auth/user-identity-service.ts`, `src/app/(public)/verify-email/page.tsx`, `src/lib/auth/credentials-authorize.ts`).
- Booking creation/update/cancel:
  1. User selects slot from availability APIs.
  2. User creates pending booking draft.
  3. User loads and applies payment option.
  4. Existing-plan path can confirm booking immediately and consume credit.
  5. Stripe path creates order/payment and checkout session.
  6. Webhook + success-page reconciliation finalizes booking/payment.
  7. Dashboard cancellation evaluates policy and optionally restores credit.
  - Flow status: Partial (no-show runtime flow not evidenced).
  - Evidence status: Confirmed from repo (`src/app/api/bookings/*`, `src/app/api/waitlist/*`, `src/lib/public-booking/*`, `src/lib/dashboard/dashboard-service.ts`), Missing / not verifiable for no-show runtime flow.
- Subscription lifecycle:
  1. Subscription page loads active checkout-enabled products.
  2. Authenticated user starts checkout.
  3. Webhook finalizes payment/order and upserts recurring `SubscriptionContract`.
  4. Success page may trigger reconciliation by `session_id`.
  5. Billing portal is available when Stripe customer exists.
  - Flow status: Confirmed.
  - Evidence status: Confirmed from repo (`src/app/(public)/subscription/page.tsx`, `src/app/api/subscription/*`, `src/lib/public-booking/stripe-webhook-service.ts`, `src/lib/subscription/ownership.ts`).
- Cart checkout (multi-item):
  1. Authenticated, active, email-verified client POSTs `{ lines, clientCartVersion }` to `POST /api/cart/checkout` with an `Idempotency-Key` header.
  2. DB-backed rate limit (10 req/min per user, `RateLimitCounter` table) is checked before body parsing.
  3. `CartCheckoutIdempotency` record is created or resolved: previously-SUCCEEDED/FAILED keys return cached responses without re-executing.
  4. `createCheckoutSessionForCart` validates line items against DB, creates order/payments, and opens a Stripe Checkout session (`CheckoutSource.CART_CHECKOUT_V1`).
  5. Client is redirected to Stripe and returns to `/subscription/success?session_id=...` (shared with subscription catalog success page).
  6. Webhook `checkout.session.completed` updates payments → SUCCEEDED, orders → PAID, bookings → CONFIRMED via `processStripeWebhookEvent`.
  7. Stale `CartCheckoutIdempotency` rows (SUCCEEDED/FAILED_* > 7 days; IN_PROGRESS > 1 hour) are cleaned up by the `GET /api/cron/maintenance` job.
  - Flow status: Confirmed.
  - Evidence status: Confirmed from repo (`src/app/api/cart/checkout/route.ts`, `src/lib/cart/cart-checkout-service.ts`, `src/lib/public-booking/checkout-service.ts`, `src/lib/public-booking/stripe-webhook-service.ts`, `src/app/api/cron/maintenance/route.ts`).
- Payment/webhook synchronization:
  1. Stripe webhook verifies signature.
  2. Handlers process checkout completion, async failures, expiry, and subscription updates/deletes.
  3. Idempotent ledger/ownership updates use unique keys and upsert/skipDuplicates patterns.
  4. Manual reconciliation is callable from success pages.
  - Flow status: Confirmed.
  - Evidence status: Confirmed from repo (`src/app/api/stripe/webhook/route.ts`, `src/lib/payments/stripe.ts`, `src/lib/public-booking/stripe-webhook-service.ts`).
- Admin management flows:
  1. Admin-authenticated user accesses private admin routes.
  2. Server actions validate inputs and invoke admin/domain services.
  3. Services mutate DB and redirect to admin pages.
  - Flow status: Confirmed.
  - Evidence status: Confirmed from repo (`src/app/admin/(private)/layout.tsx`, `src/app/admin/(private)/actions.ts`, `src/lib/admin/admin-service.ts`).
- Email verification / password reset / identity changes:
  1. Verification tokens are generated/sent/consumed for signup and email change.
  2. Password reset tokens are hashed, one-time claimed transactionally, then sessions are invalidated.
  3. Dashboard email change requires current password and new-email verification.
  - Flow status: Confirmed.
  - Evidence status: Confirmed from repo (`src/lib/auth/user-identity-service.ts`, `src/lib/auth/password-service.ts`, `src/lib/dashboard/dashboard-service.ts`).

## 6. Data model summary
- Main entities:
  - Auth/identity: `User`, `Account`, `Session`, `VerificationToken`, `PendingUserRegistration`, `PasswordResetToken`, rate-limit tables.
  - Catalog/pricing: `Product`, `Price`, `EntitlementRule`.
  - Scheduling/booking: `ClassCategory`, `ClassType`, `ClassTemplate`, `RecurringRule`, `StudioSession`, `Booking`, `BookingPolicy`, `WaitlistEntry`, `AttendanceRecord`.
  - Commerce: `Order`, `OrderItem`, `Payment`, `SubscriptionContract`, `ClientEntitlement`, `CreditLedgerEntry`, `LoyaltyLedgerEntry`.
  - Admin/support/marketing/content: `AuditLog`, `AdminNote`, `ContactMessage`, `ClientMessage`, `PublicDocument`, learning and marketing models.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`).
- Key relationships:
  - Booking -> session + optional client/order/selected entitlement/selected price.
  - Product -> prices + entitlement rules.
  - SubscriptionContract -> user + product + price.
  - Credit/Loyalty ledgers reference user and optional entitlement/booking/order.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`).
- Constraints / uniqueness:
  - Active bookings use migration-owned partial uniqueness on `Booking(clientId, studioSessionId)` where status is `PENDING` or `CONFIRMED`.
  - `Price.lookupKey` unique, `Price.stripePriceId` unique when present.
  - `Payment.stripeCheckoutSessionId` unique.
  - `CreditLedgerEntry.idempotencyKey` unique.
  - `SubscriptionContract(provider, providerSubscriptionReference)` unique.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`).
- Audit/provenance fields:
  - Widespread `createdAt/updatedAt`.
  - `AuditLog` model and `createdById` references in ledger/admin mutations.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`, `src/lib/admin/admin-service.ts`).

## 7. Auth and security architecture
- Auth provider/library setup:
  - NextAuth v5 beta + credentials provider + Prisma adapter; JWT strategy.
  - Evidence status: Confirmed from repo (`src/auth.ts`, `package.json`).
- Session model:
  - JWT token enriched with `id` and `role`, propagated to session.
  - Evidence status: Confirmed from repo (`src/auth.ts`, `src/types/next-auth.d.ts`).
- Route protection:
  - `requireVerifiedUser` for protected customer routes.
  - `requireAdminSession` for admin routes.
  - Evidence status: Confirmed from repo (`src/lib/auth/require-auth.ts`, layout files).
- CSRF / token / verification mechanisms:
  - NextAuth default CSRF handling is implied for auth endpoints.
  - Custom token hashing/expiry/one-time semantics for verification/email change/password reset.
  - No dedicated custom CSRF middleware found for non-auth mutations.
  - Evidence status: Confirmed from repo for token flows; Inferred from repo for NextAuth CSRF; Missing / not verifiable for custom CSRF layer.
- Security-sensitive flows:
  - Stripe signature verification.
  - Password reset one-time claim + session invalidation.
  - Email change requires current password + verification token.
  - Contact/auth/booking rate limiting.
  - Evidence status: Confirmed from repo (`src/lib/payments/stripe.ts`, `src/lib/auth/password-service.ts`, `src/lib/auth/user-identity-service.ts`, `src/lib/security/rate-limit.ts`, `src/lib/client-messages/client-message-service.ts`).
- Known hardening already present:
  - Sentry sensitive data sanitization.
  - Safe callback URL handling.
  - Login/signup anti-abuse checks.
  - Evidence status: Confirmed from repo (`src/lib/observability/sentry-sanitize.ts`, `src/lib/auth/safe-callback-url.ts`, `src/lib/auth/user-identity-service.ts`).
  - Known security gaps visible from code only:
  - Teacher route group uses explicit server-side auth/role gate via `requireTeacherSession` with DB re-validation on every request.
  - In-memory rate limiter is not shared across instances/restarts.
  - Evidence status: Confirmed from repo (`src/app/teacher/layout.tsx`, `src/lib/security/rate-limit.ts`, `src/lib/marketing/marketing-tracking.ts`).

## 8. Billing and subscription architecture
- Stripe usage and boundaries:
  - Checkout session creation for booking and catalog purchase flows.
  - Billing portal session creation.
  - Webhook verification and event processing.
  - Evidence status: Confirmed from repo (`src/lib/payments/stripe.ts`, `src/lib/public-booking/checkout-service.ts`, `src/app/api/subscription/portal/route.ts`).
- Webhook role:
  - Central finalization for payment/order status, entitlement grants/consumption, booking confirmation, subscription contract updates.
  - Evidence status: Confirmed from repo (`src/lib/public-booking/stripe-webhook-service.ts`).
- Source of truth:
  - Local DB (`Payment`, `Order`, `SubscriptionContract`, `ClientEntitlement`, `CreditLedgerEntry`) is updated by webhook/reconciliation paths.
  - Evidence status: Confirmed from repo.
- Failure handling / idempotency:
  - Unique constraints and idempotency keys; upsert/skipDuplicate patterns.
  - Expired/failed checkout events mark payment/order failure.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`, `src/lib/public-booking/stripe-webhook-service.ts`).
- Reconciliation logic:
  - Success pages call reconciliation helpers by `session_id`.
  - Evidence status: Confirmed from repo (`src/app/(public)/book-a-class/[serviceSlug]/payment/success/page.tsx`, `src/app/(protected)/subscription/success/page.tsx`).

## 9. Admin architecture
- Admin entry points:
  - `/admin` sign-in and `/admin/(private)/*` route tree.
  - Evidence status: Confirmed from repo (`src/app/admin/page.tsx`, `src/app/admin/(private)`).
- Admin auth flow:
  - Credentials sign-in, role check via `isAdminRole`, private layout guard via `requireAdminSession`.
  - Evidence status: Confirmed from repo (`src/app/admin/page.tsx`, `src/lib/auth/require-auth.ts`).
- Admin data mutation paths:
  - Central server actions call service layer modules.
  - Evidence status: Confirmed from repo (`src/app/admin/(private)/actions.ts`, `src/lib/admin/admin-service.ts`).
- Special protections / restrictions:
  - Action-level `assertAdminAccess`.
  - Credit adjustments validate actor role and client target role.
  - Evidence status: Confirmed from repo (`src/app/admin/(private)/actions.ts`, `src/lib/admin/admin-service.ts`).
- MFA:
  - No MFA implementation found.
  - Evidence status: Missing / not verifiable from repository.

## 10. Frontend architecture
- App structure:
  - Route groups: `(public)`, `(protected)`, `admin`, `api`, `auth`, `m`, `teacher`.
  - Evidence status: Confirmed from repo (`src/app`).
- Routing model:
  - Next.js App Router with server-rendered pages and API route handlers; server actions for mutations.
  - Evidence status: Confirmed from repo.
- Shared UI patterns:
  - Shared navbar/footer/dashboard/admin sidebar components; modular feature components in `src/components`.
  - Evidence status: Confirmed from repo.
- State/data fetching patterns:
  - Server components for initial data.
  - Client components for interaction-heavy booking/subscription steps.
  - Evidence status: Confirmed from repo.
- Forms/validation approach:
  - Zod validation in API routes/server actions before mutations.
  - Evidence status: Confirmed from repo.
## 11. Infrastructure and environments
### 11.1 Confirmed from repo
- Hosting clues in repo:
  - No Terraform/Ansible/K8s manifests; app appears built for Node process runtime + external host infra.
  - Evidence status: Confirmed from repo.
- Runtime model:
  - `next build` + `next start`; PM2 usage is not codified as a process file in repo.
  - Evidence status: Confirmed from repo (`package.json`), Missing process file in repo.
- Docker/container usage:
  - Local `docker-compose.yml` includes only `postgres:16` service.
  - No app Dockerfile found.
  - Evidence status: Confirmed from repo (`docker-compose.yml`, repository scan).
- Database technology:
  - PostgreSQL via Prisma datasource.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`, `src/lib/db.ts`).
- Reverse proxy/web server:
  - No nginx/caddy/apache config files in repo.
  - Evidence status: Missing / not verifiable from repository.
- Background jobs/cron/schedulers:
  - No in-app scheduler/worker process found.
  - Evidence status: Confirmed from repo.
- Static asset handling:
  - Static files in `public/`; standard Next.js static handling.
  - Evidence status: Confirmed from repo.
- Environment separation:
  - `.env`, `.env.local`, `.env.test`, `.env.test.example`; CI env in workflow.
  - Evidence status: Confirmed from repo.

### 11.2 Production setup known from deployment/config artifacts
- Deployment model (documented):
  - Ubuntu server with Node 20, PM2, Dockerized PostgreSQL, nginx reverse proxy, certbot SSL, manual git-pull deploy flow.
  - Evidence status: Confirmed from deployment/config artifacts; Operator-stated / external to repo for current live-state (`docs/50_02_bookmyclass_server_setup_updated.md`, `docs/50_08_pm2_autostart_setup.md`).
- Hosting provider/model (documented):
  - Hetzner Cloud VM docs present (`CX23`, Ubuntu 24.04).
  - Evidence status: Confirmed from deployment/config artifacts; Operator-stated / external to repo for current live-state (`docs/50_01_setup_server_hetzner.md`).
- DB hosting model (documented):
  - PostgreSQL in Docker container with local binding + SSH tunnel access.
  - Evidence status: Confirmed from deployment/config artifacts; Operator-stated / external to repo for current live-state (`docs/50_02_bookmyclass_server_setup_updated.md`, `docs/50_11_db_setup_guide.md`, `docs/50_10_remote_access_guide.md`).
- Migration/restart strategy (documented):
  - `prisma migrate deploy`, `prisma generate`, `npm run build`, `pm2 restart ... --update-env`.
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_02_bookmyclass_server_setup_updated.md`).
- SSL/domain/routing (verified live on April 18, 2026):
  - `bookmyclass.app` and `www.bookmyclass.app` serve static homesite from nginx.
  - `bookmyclass.app/api/contact-form` proxies to `127.0.0.1:3000/api/contact-form`.
  - `demo.bookmyclass.app` proxies to `127.0.0.1:3000`.
  - Evidence status: Verified live + confirmed from deployment/config artifacts.
- Monitoring/backup ops model (documented):
  - Uptime Kuma + Healthchecks + Netdata + local health scripts + backup scripts/heartbeat.
  - Evidence status: Confirmed from deployment/config artifacts; Operator-stated / external to repo for current live-state (`docs/50_06_monitoring_alerting_setup.md`, `docs/50_07_monitoring_netdata_setup.md`, `docs/50_09_monitoring_system_guide.md`, `docs/50_04_db_backup_local_setup.md`, `docs/50_05_backblaze_b2_backup_setup.md`, `scripts/verify-production-readiness.sh`).

### 11.3 Not verifiable from repo
- Which documented production setup steps are currently active on live hosts (without live host access).
- Cloudflare dashboard-side tunnel/public-hostname configuration and permissions model.
- Exact production secret rotation history/state.
- Evidence status: Not verifiable from repository alone.

## 12. Production inventory
- Next.js app runtime (Node/PM2):
  - Purpose: serve web app/API.
  - Status: Confirmed from repo (runtime scripts), Confirmed from config/docs (PM2 model), live-active state not verifiable.
- PostgreSQL:
  - Purpose: primary relational datastore.
  - Status: Confirmed from repo; Confirmed from config/docs for production model; live state not verifiable.
- Docker containers:
  - Purpose: documented DB container runtime.
  - Status: Confirmed from repo for local compose; Confirmed from config/docs for production docs; live inventory not verifiable.
- Reverse proxy (nginx):
  - Purpose: HTTP(S) termination and proxy to app.
  - Status: Confirmed from config/docs; not present as repo config file; live state not verifiable.
- Stripe:
  - Purpose: checkout, webhook, billing portal.
  - Status: Confirmed from repo.
- Resend:
  - Purpose: verification/password reset/marketing email sends.
  - Status: Confirmed from repo.
- Backblaze B2:
  - Purpose: offsite backup destination (documented).
  - Status: Confirmed from config/docs; not app-runtime-integrated code path.
- Monitoring tools:
  - Sentry: app error monitoring.
  - Uptime Kuma (`monitor.bookmyclass.app` docs): uptime monitoring.
  - Healthchecks (`checks.bookmyclass.app` docs): backup heartbeat.
  - Netdata: host metrics.
  - Status: Sentry confirmed from repo; others confirmed from config/docs; live state not verifiable.
- Cron/worker processes:
  - Documented root cron for health checks and backups.
  - No in-app queue/worker service found.
  - Status: Cron confirmed from config/docs; live crontab not verifiable.

## 13. Observability and operations
- Sentry/logging/tracing:
  - Server/edge/client Sentry setup with sanitizer and production-only enable flag.
  - Evidence status: Confirmed from repo (`instrumentation.ts`, `instrumentation-client.ts`, `sentry.*.config.ts`, `src/lib/observability/sentry-sanitize.ts`).
- Health endpoints:
  - `/api/health` checks DB readiness and returns `200` or `503`.
  - Evidence status: Confirmed from repo (`src/app/api/health/route.ts`).
- Uptime monitoring:
  - Uptime Kuma usage documented with health/page checks.
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_06_monitoring_alerting_setup.md`, `docs/50_09_monitoring_system_guide.md`).
- Heartbeat/cron monitoring:
  - Healthchecks-based backup heartbeat documented.
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_09_monitoring_system_guide.md`).
- Backup/restore evidence:
  - Backup and restore runbooks/scripts documented (local + offsite B2).
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_04_db_backup_local_setup.md`, `docs/50_05_backblaze_b2_backup_setup.md`).
- Operational dashboards/tools:
  - Netdata documented as private host diagnostics.
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_07_monitoring_netdata_setup.md`).
- On-host/process monitoring:
  - PM2 status/log checks and local healthcheck workflows documented.
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_08_pm2_autostart_setup.md`, `docs/50_09_monitoring_system_guide.md`).
- Gaps visible from repo:
  - No machine-verifiable infra state (no IaC/deploy manifests).
  - Evidence status: Confirmed from repo.

## 14. Testing
- Test frameworks/tools:
  - Vitest, Testing Library, Playwright.
  - Evidence status: Confirmed from repo (`package.json`, `vitest.config.ts`, `playwright.config.ts`).
- Coverage types present:
  - `test/unit`, `test/integration`, `test/ui`, `test/e2e`, `test/manual`.
  - Evidence status: Confirmed from repo (`test/` tree).
- Important suites visible:
  - Auth flows, route protection, booking draft/payment options/checkout, webhook API, dashboard services, admin actions/pages, public catalogue, learning endpoints.
  - Evidence status: Confirmed from repo.
- Missing critical test areas:
  - Limited e2e (single Playwright mobile navigation spec).
  - No-show runtime workflow not implemented/covered.
  - Teacher route auth behavior has explicit UI/E2E coverage (`test/ui/teacher-layout.ui.test.tsx`, `test/e2e/teacher-flow.spec.ts`).
  - Evidence status: Confirmed from repo / Inferred from test inventory + feature implementation.

## 15. CI/CD
- Pipelines/workflows present:
  - Single GitHub Actions workflow `ci.yml` on push + pull_request.
  - Evidence status: Confirmed from repo.
- Build/test/deploy gates:
  - `npm ci`, Prisma generate, build, tests (`npm test -- --run`), `prisma migrate status`.
  - No deploy job.
  - Evidence status: Confirmed from repo.
- Migration/release handling:
  - CI migration status check; integration tests apply test migrations in setup.
  - Release-readiness helper script exists and requires explicit operator confirmations + health check.
  - Evidence status: Confirmed from repo (`.github/workflows/ci.yml`, `test/integration/helpers/setup-env.ts`, `scripts/verify-production-readiness.sh`).
- Absent/unclear:
  - No automated production deployment workflow in repository.
  - Evidence status: Missing / not verifiable from repository.
## 16. Configuration and secrets
- Auth/session:
  - `AUTH_SECRET` (NextAuth secret).
  - `NEXTAUTH_SECRET` (used as fallback in marketing tracking secret chain).
  - Evidence status: Confirmed from repo (`src/auth.ts`, `src/lib/marketing/marketing-tracking.ts`).
- App/runtime:
  - `DATABASE_URL`, `APP_URL`, `NODE_ENV`, `NEXT_RUNTIME`.
  - Evidence status: Confirmed from repo.
- Stripe/billing:
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
  - Evidence status: Confirmed from repo (`src/lib/payments/stripe.ts`).
- Email:
  - `RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_FORM_TO_EMAIL` (homesite contact form recipient).
  - Evidence status: Confirmed from repo.
  - Marketing tracking:
  - `MARKETING_TRACKING_SECRET` (fallback chain includes `NEXTAUTH_SECRET`, then default constant).
  - Evidence status: Confirmed from repo.
- Sentry/observability:
  - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `NEXT_PUBLIC_SENTRY_RELEASE`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `CI`, `VERCEL_GIT_COMMIT_SHA`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, `GIT_SHA`.
  - Evidence status: Confirmed from repo.
- Seed/test-specific:
  - `LEARNING_SEED_JSON_PATH`, `DASHBOARD_TREND_AS_OF_DATE`.
  - `STRIPE_PRICE_ID_COLLECTIVE_DROP_IN`, `STRIPE_PRICE_ID_COLLECTIVE_5_PACK`, `STRIPE_PRICE_ID_COLLECTIVE_10_PACK`, `STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE`, `STRIPE_PRICE_ID_PRIVATE_5_PACK`, `STRIPE_PRICE_ID_PRIVATE_10_PACK`.
  - `.env.test` requires `DATABASE_URL`.
  - Evidence status: Confirmed from repo (`prisma/seed.ts`, `test/integration/helpers/setup-env.ts`, `.env.test.example`).
- Required vs optional (determinable):
  - Required for app boot: `DATABASE_URL`.
  - Practically required for auth sessions: `AUTH_SECRET`.
  - Required for Stripe flows: `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Required for live provider email delivery (non-test runtimes): `RESEND_API_KEY`, `EMAIL_FROM`.
- Required for homesite contact-form email delivery: `CONTACT_FORM_TO_EMAIL`.
  - Test/e2e runtimes can use deterministic provider bypass (`NODE_ENV=test` or `E2E_TEST_MODE=1`) and do not require real Resend delivery configuration.
  - Optional feature envs: Sentry + seed extras.
  - Evidence status: Confirmed from repo + Inferred from code paths.

## 17. Key architectural decisions currently enforced
- Product+Price catalog source of truth:
  - Subscription catalog and checkout paths fetch active products/prices.
  - Evidence status: Confirmed from repo (`src/lib/subscription/subscription-products.ts`, `src/app/api/subscription/*`).
- Server-side rule enforcement:
  - Booking/payment eligibility and mutations handled server-side in routes/services.
  - Evidence status: Confirmed from repo (`src/lib/public-booking/*`, `src/app/api/bookings/*`).
- Centralized service boundaries:
  - Domain logic concentrated in `src/lib/*` modules consumed by routes/actions.
  - Evidence status: Confirmed from repo.
- Idempotent financial-like patterns:
  - Ledger idempotency keys and webhook-safe upsert/skipDuplicate patterns.
  - Evidence status: Confirmed from repo (`prisma/schema.prisma`, `src/lib/public-booking/stripe-webhook-service.ts`).
- Trusted mutation paths:
  - Admin mutations go through admin server actions + service layer.
  - Evidence status: Confirmed from repo.

## 18. Known gaps / risks
- Teacher route group is server-enforced via `requireTeacherSession`; keep regression coverage active for role redirects.
  - Evidence status: Confirmed from repo (`src/app/teacher/layout.tsx`, `test/ui/teacher-layout.ui.test.tsx`, `test/e2e/teacher-flow.spec.ts`).
- No-show workflow is modeled but not implemented in active app flows.
  - Evidence status: Confirmed from repo (schema present, route/service usage absent).
- In-memory rate limiters are process-local.
  - Evidence status: Confirmed from repo (`src/lib/security/rate-limit.ts`).
- Marketing send path can report send success when `RESEND_API_KEY` is missing.
  - Evidence status: Confirmed from repo (`src/lib/marketing/marketing-delivery.ts`).
- Production documentation conflicts:
  - Conflicting server IPs (`46.62.208.152` vs `37.27.192.11`).
  - Mixed DB naming examples (`bookmyclass-app-db` vs `bookmyclass`).
  - Mixed auth secret naming in docs (`NEXTAUTH_SECRET`) vs runtime code (`AUTH_SECRET`).
  - Evidence status: Confirmed from deployment/config artifacts (`docs/50_01_setup_server_hetzner.md`, `docs/50_02_bookmyclass_server_setup_updated.md`, `docs/50_10_remote_access_guide.md`, `docs/50_11_db_setup_guide.md`).
- CI lacks lint gate and deployment automation.
  - Evidence status: Confirmed from repo (`.github/workflows/ci.yml`).

## 19. Safe working agreement for future contributors
- Add domain logic in `src/lib/*` services; keep frontend focused on presentation and interaction.
- Keep booking/payment/subscription/auth rule enforcement server-side.
- Reuse existing service modules; do not duplicate business rules across routes/actions/components.
- Before deploy, verify:
  - Prisma schema + migrations are in sync.
  - Booking + checkout + webhook paths still reconcile correctly.
  - Admin mutation paths still require admin session.
  - `/api/health` is healthy.
  - CI build + tests pass.

## 20. Environments (Canonical)

The system currently operates with production, UAT/staging, and local
development/test environments. UAT is operational for operator-run manual
validation and must not be treated as an automatic release gate.

### Production
- Hetzner VM
- Public domain (bookmyclass.app)
- Real Stripe mode
- Real users

### UAT (Staging)
- Status: operational for manual operator validation.
- The operator runs UAT smoke, security, performance, or E2E checks when release
  scope requires them.
- UAT evidence is collected as manual release validation and does not imply an
  automatic deployment or promotion gate.

### Local
- Developer machine
- Used for:
  - unit/integration tests
  - E2E dev runs
  - k6 load testing
  - Stripe CLI webhook simulation for payment/webhook development
  
## Appendix A: Important files and folders
- `package.json`: scripts and dependency versions.
- `package-lock.json`: lock state.
- `README.md`: project/run overview.
- `src/app/`: routes, layouts, API handlers, server actions.
- `src/lib/`: domain and integration services.
- `src/components/`: reusable UI.
- `prisma/schema.prisma`: canonical data model.
- `prisma/migrations/`: migration history.
- `prisma/seed.ts`: deterministic seed and env validation.
- `.github/workflows/ci.yml`: CI definition.
- `docker-compose.yml`: local PostgreSQL service.
- `test/`: unit/integration/ui/e2e/manual tests.
- `scripts/`: verification/import/maintenance scripts.
- `docs/`: domain rules + operational/deployment runbooks.

## Appendix B: Scripts and commands
- App lifecycle:
  - `npm run dev`
  - `npm run build`
  - `npm run start`
  - `npm run lint`
- Tests:
  - `npm test`
  - `npm test -- --run`
  - `npm run test:e2e`
- Prisma/database:
  - `npm run prisma:generate`
  - `npm run prisma:seed`
  - `npm run db:seed`
  - `npm run db:reset`
  - `npm run db:test:setup`
  - `npm run db:test:reset`
- Verification/import:
  - `npm run learning:import`
  - `npm run db:verify:dashboard-seed`
  - `npm run db:verify:dashboard-trend-seed`
- Operations:
  - `npm run ops:verify-production-readiness -- --confirm-kuma --confirm-backup-heartbeat --confirm-local-healthcheck --confirm-latest-backup --confirm-restore-proof`
- Docker:
  - `docker compose up -d postgres`
- Deploy commands/scripts in repo:
  - No executable in-repo deploy script found.
  - Manual deploy sequence documented in `docs/50_02_bookmyclass_server_setup_updated.md`.
## Appendix C: Production evidence notes
- Core runtime/config evidence:
  - `package.json`
  - `.github/workflows/ci.yml`
  - `docker-compose.yml`
  - `prisma/schema.prisma`
  - `src/lib/db.ts`
- Billing/checkout/webhook evidence:
  - `src/lib/payments/stripe.ts`
  - `src/lib/public-booking/checkout-service.ts`
  - `src/lib/public-booking/stripe-webhook-service.ts`
  - `src/app/api/stripe/webhook/route.ts`
  - `src/app/api/subscription/*`
- Auth/security evidence:
  - `src/auth.ts`
  - `src/lib/auth/*`
  - `src/lib/security/rate-limit.ts`
  - `src/lib/observability/sentry-sanitize.ts`
  - `instrumentation.ts`
  - `instrumentation-client.ts`
  - `sentry.server.config.ts`
  - `sentry.edge.config.ts`
- Admin and operations evidence:
  - `src/app/admin/(private)/actions.ts`
  - `src/lib/admin/admin-service.ts`
  - `src/app/admin/(private)/*`
  - `src/lib/client-messages/client-message-service.ts`
  - `src/lib/public-documents/agenda-document-service.ts`
- Deployment/production setup docs evidence:
  - `docs/50_01_setup_server_hetzner.md`
  - `docs/50_02_bookmyclass_server_setup_updated.md`
  - `docs/50_03_prisma_studio_remote_usage.md`
  - `docs/50_04_db_backup_local_setup.md`
  - `docs/50_05_backblaze_b2_backup_setup.md`
  - `docs/50_06_monitoring_alerting_setup.md`
  - `docs/50_07_monitoring_netdata_setup.md`
  - `docs/50_08_pm2_autostart_setup.md`
  - `docs/50_09_monitoring_system_guide.md`
  - `docs/50_10_remote_access_guide.md`
  - `docs/50_11_db_setup_guide.md`
  - `scripts/verify-production-readiness.sh`

## Appendix D: Missing operator-supplied facts
- Confirm Cloudflare dashboard/API ownership path for remote-managed tunnel ingress updates.
- Confirm whether documented Backblaze B2 upload is active in production.
- Confirm live Healthchecks configuration and alert channels.
- Confirm Sentry project/environment values in production.
- Confirm exact manual deploy runbook currently used (including rollback steps).
