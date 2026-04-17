# System Summary — BookMyClass SaaS

## 1. Purpose
BookMyClass is a booking and subscription SaaS for a yoga/pilates/fitness studio. It supports public discovery, authenticated customer bookings, Stripe-powered checkout, and an admin back office.

## 2. System Architecture
Next.js App Router monolith drives frontend, API route handlers, server actions, and domain services. Prisma ORM with PostgreSQL persistence stores users, bookings, products, orders, subscriptions, entitlements, and ledger entries. Stripe is the primary payments and billing integration, including checkout, billing portal, and webhooks. External services include Resend for email delivery and Sentry for monitoring and error tracking. Runtime is documented as nginx terminating TLS and proxying to a Node/Next.js app managed by PM2.

BOOK MY CLASS SAAS — COMPLETE CURRENT ARCHITECTURE

======================================================================
1) USERS / ENTRY POINTS
======================================================================

                         +----------------------------------+
                         |          END USERS               |
                         |----------------------------------|
                         | Clients                          |
                         | Admin / Master Admin             |
                         | Teacher (limited / not fully     |
                         | confirmed as production-ready)   |
                         +-----------------+----------------+
                                           |
                                           v

                         +----------------------------------+
                         |            INTERNET              |
                         +-----------------+----------------+
                                           |
                     +---------------------+----------------------+
                     |                                            |
                     v                                            v
      +----------------------------------+         +----------------------------------+
      |     bookmyclass.app / www        |         |       uat.bookmyclass.app        |
      |          Production              |         |              UAT                 |
      +----------------------------------+         +----------------------------------+

======================================================================
2) EDGE / HOST RUNTIME
======================================================================

Production / UAT documented runtime:
- nginx terminates TLS and proxies to 127.0.0.1:3000.
- Next.js app runs under PM2.
- PostgreSQL runs on the host, documented as Docker-managed.
- Health checks, backup cron, and monitoring are documented.
- UAT uses the same architecture as production.
- local k6 runs from the developer machine, not from UAT host.

                         +----------------------------------+
                         |            NGINX                 |
                         |   TLS / reverse proxy / domain   |
                         +-----------------+----------------+
                                           |
                                           v
                         +----------------------------------+
                         |       Next.js App Router         |
                         |       Node runtime on PM2        |
                         |        app port = 3000           |
                         |       PM2 app = bookmyclass-app  |
                         +-----------------+----------------+
                                           |
                     +---------------------+----------------------+
                     |                                            |
                     v                                            v
         +---------------------------+              +-----------------------------+
         |   Route Handlers / APIs   |              |    Server Actions           |
         |   src/app/api/*           |              |    admin/dashboard paths    |
         +---------------------------+              +-----------------------------+
                     \                                            /
                      \                                          /
                       \                                        /
                        v                                      v
                         +----------------------------------+
                         |    Domain Services (src/lib/*)   |
                         |----------------------------------|
                         | auth                            |
                         | public-booking                  |
                         | subscription                    |
                         | dashboard                       |
                         | admin                           |
                         | marketing / client messages     |
                         | observability / security        |
                         +-----------------+----------------+
                                           |
                                           v
                         +----------------------------------+
                         |       Prisma + PostgreSQL        |
                         |      persistence / source        |
                         +-----------------+----------------+
                                           |
                                           v
                         +----------------------------------+
                         |       PostgreSQL database        |
                         |        (Docker on server)        |
                         +----------------------------------+

## 3. Application Structure
Next.js App Router monolith with server components, client components, route handlers, and server actions. Domain services live under src/lib and support auth, public booking, subscription, dashboard, admin, marketing/client messages, observability, and security.

======================================================================
3) FRONTEND STRUCTURE
======================================================================

The app is a Next.js App Router monolith with server components, client
components, route handlers, and server actions. Route groups include
(public), (protected), admin, api, auth, m, and teacher. :contentReference[oaicite:7]{index=7} :contentReference[oaicite:8]{index=8}

+----------------------------------------------------------------------------------+
| src/app                                                                          |
|----------------------------------------------------------------------------------|
| (public)     -> home, about, book-a-class, subscription, learning               |
| (protected)  -> customer dashboard, bookings, membership, profile               |
| admin        -> /admin sign-in + /admin/(private) back office                   |
| api          -> booking, subscription, checkout, webhook, health, catalogue     |
| auth         -> auth endpoints / flows                                           |
| m            -> extra route group                                                |
| teacher      -> exists, but enforcement/workflows not fully confirmed            |
+----------------------------------------------------------------------------------+

## 4. Core Business Flows
Public sign-up / sign-in uses credentials auth with pending registration and email verification. Verified users receive JWT-backed sessions for protected customer routes. Admin routes require a separate admin session guard. Password reset and email-change verification are supported. Teacher role exists, but the runtime usage and enforcement are not fully confirmed.

                        +-------------+
                        |   Browser   |
                        +------+------+
                               |
                               v
                    +-----------------------+
                    | Auth pages / handlers |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    | auth services         |
                    | - registration        |
                    | - verification        |
                    | - password reset      |
                    | - email change        |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    | User / Session /      |
                    | PendingRegistration / |
                    | VerificationToken     |
                    +-----------------------+

Customers browse public catalogue and availability APIs. Booking drafts are created before payment or entitlement application. Payment options include entitlement consumption or Stripe checkout. Success-page reconciliation finalizes booking, payment, and entitlement state. Waitlist join/cancel and auto-promotion are active for collective classes; no-show handling remains modeled and not fully active.

+---------+    +------------------+    +--------------------+
| Client  | -> | Public catalogue | -> | Availability APIs  |
+---------+    +------------------+    +--------------------+
                                              |
                                              v
                                     +--------------------+
                                     | POST /bookings/    |
                                     | draft              |
                                     +--------------------+
                                              |
                                              v
                                     +--------------------+
                                     | payment-options    |
                                     | apply-plan         |
                                     +--------------------+
                                              |
                         +--------------------+--------------------+
                         |                                         |
                         v                                         v
              +------------------------+               +------------------------+
              | Existing entitlement   |               | Stripe checkout        |
              | immediate confirmation |               | order/payment/session  |
              +-----------+------------+               +-----------+------------+
                          |                                        |
                          +--------------------+-------------------+
                                               |
                                               v
                                     +---------------------------+
                                     | webhook + success-page    |
                                     | reconciliation            |
                                     +---------------------------+
                                               |
                                               v
                                     +---------------------------+
                                     | Booking + Payment +       |
                                     | Entitlement state         |
                                     +---------------------------+

Catalog offerings are driven by Product + Price. The subscription page shows purchasable products, not only recurring items. Checkout creates Stripe sessions and uses webhooks for payment/order reconciliation. Successful checkout updates Order, Payment, SubscriptionContract, and ClientEntitlement records. Stripe mode is derived from product/price configuration, not assumed from the page name.

+---------+    +---------------------+    +-----------------------------+
| Client  | -> | /subscription page  | -> | Active Product + Price      |
+---------+    +---------------------+    +-----------------------------+
                                                     |
                                                     v
                                      +------------------------------+
                                      | POST /api/subscription/      |
                                      | checkout                     |
                                      +------------------------------+
                                                     |
                                                     v
                                              +-------------+
                                              |   Stripe    |
                                              +------+------+ 
                                                     |
                                                     v
                                      +------------------------------+
                                      | webhook + success            |
                                      | reconciliation               |
                                      +------------------------------+
                                                     |
                                                     v
                                      +------------------------------+
                                      | Order / Payment /            |
                                      | SubscriptionContract /       |
                                      | ClientEntitlement            |
                                      +------------------------------+

Admin users sign in at `/admin` and access private admin routes. Private admin pages use server action form handling and domain services for mutations. Admin services update bookings, products, subscriptions, users, marketing inbox, and other back-office data. Admin/MasterAdmin role separation is limited in current runtime enforcement.

+-------------------+    +----------------------+    +----------------------+ 
| Admin / Master    | -> | /admin sign-in       | -> | /admin/(private)     |
| Admin             |    | + role check         |    | pages                |
+-------------------+    +----------------------+    +----------+-----------+
                                                                      |
                                                                      v
                                                         +----------------------+ 
                                                         | Server Actions       |
                                                         | assertAdminAccess    |
                                                         +----------+-----------+
                                                                      |
                                                                      v
                                                         +----------------------+ 
                                                         | admin-service +      |
                                                         | domain services      |
                                                         +----------+-----------+
                                                                      |
                                                                      v
                                                         +----------------------+ 
                                                         | PostgreSQL           |
                                                         +----------------------+ 

## 5. Data Architecture
Auth, Booking, Catalog (Product/Price), Commerce (Order/Payment), Entitlements / Credits. Product is the source of truth for catalog offerings. Every booking must be backed by a valid entitlement.

+----------------------------------------------------------------------------------+
| AUTH / IDENTITY                                                                  |
| User | Account | Session | VerificationToken | PendingUserRegistration |         |
| PasswordResetToken | rate-limit tables                                        |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| CATALOG / BILLING                                                                |
| Product | Price | EntitlementRule | Order | OrderItem | Payment |                |
| SubscriptionContract | ClientEntitlement                                         |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| SCHEDULING / BOOKINGS                                                            |
| ClassCategory | ClassType | ClassTemplate | RecurringRule | StudioSession |      |
| Booking | BookingPolicy | WaitlistEntry | AttendanceRecord                       |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| LEDGERS / SUPPORT / OPERATIONS                                                   |
| CreditLedgerEntry | LoyaltyLedgerEntry | AuditLog | AdminNote |                  |
| ContactMessage | ClientMessage | PublicDocument                                  |
+----------------------------------------------------------------------------------+

## 6. External Integrations
Stripe for payments, subscription checkout, billing portal, and webhook event processing. Resend for outbound email delivery for verification, password reset, and notification email flows. Sentry for monitoring, error reporting, and sanitization for server/client/edge code.

                         +----------------------------------+
                         |         EXTERNAL SERVICES        |
                         +----------------------------------+

   +-----------------+     +----------------+     +------------------+
   | Stripe          |     | Resend         |     | Sentry           |
   |-----------------|     |----------------|     |------------------|
   | checkout        |     | verification   |     | server/client/   |
   | billing portal  |     | password reset |     | edge monitoring  |
   | webhooks        |     | email sending  |     | sanitization     |
   +--------+--------+     +--------+-------+     +---------+--------+
            |                       |                         |
            +-----------+-----------+-------------------------+
                        |
                        v
               +----------------------+ 
               | Next.js monolith     |
               | src/lib integrations |
               +----------------------+ 

## 7. Environments
Local: Developer machine with local Next.js execution, local Docker/PostgreSQL, unit/integration tests, and local load/test tooling. Local environment is for development and does not reflect prod Stripe mode.

UAT: Separate Hetzner VM with the same documented architecture as production. Uses Stripe test mode and serves as the pre-release validation target. E2E tests, k6 load generation, and webhook validation are run against UAT.

Production: Hetzner VM with public domain and real Stripe live mode. Architecture is intended to match UAT, but exact host topology and some container naming are marked as operator confirmation needed.

+----------------------------------------------------------------------------------+
| LOCAL                                                                            |
|----------------------------------------------------------------------------------|
| Developer machine                                                                |
| - unit/integration tests                                                         |
| - E2E dev runs                                                                   |
| - k6 load testing                                                                |
| - local docker-compose includes postgres only                                    |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| UAT                                                                              |
|----------------------------------------------------------------------------------|
| Separate Hetzner VM                                                              |
| - same architecture as production                                                |
| - Stripe test mode                                                               |
| - pre-release validation                                                         |
| - E2E tests                                                                      |
| - webhook validation                                                             |
| - load testing                                                                   |
| - deploy/verify/reset/scale on host                                              |
| - k6 load generated locally, not on the UAT host                                 |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| PRODUCTION                                                                       |
|----------------------------------------------------------------------------------|
| Hetzner VM                                                                       |
| - public domain                                                                  |
| - real Stripe mode                                                               |
| - real users                                                                     |
| - exact host topology still needs operator confirmation                          |
+----------------------------------------------------------------------------------+

## 8. Operations & Observability
Health endpoint exists for runtime readiness checks. The Next.js app runs under PM2 with documented app name `bookmyclass-app`. Monitoring includes Uptime Kuma, healthchecks, and Netdata on the host. Backup and health scripts are documented as cron jobs on the deployment host.

                         +----------------------------------+
                         |        OBSERVABILITY LAYER       |
                         +----------------------------------+

       +---------------------+   +--------------------+   +-------------------+
       | /api/health         |   | Sentry             |   | PM2 status/logs   |
       | DB readiness        |   | app monitoring     |   | process health    |
       +---------------------+   +--------------------+   +-------------------+ 

       +---------------------+   +--------------------+   +-------------------+
       | Uptime Kuma         |   | Healthchecks       |   | Netdata           |
       | uptime/page checks  |   | backup heartbeat   |   | host metrics      |
       +---------------------+   +--------------------+   +-------------------+ 

       +---------------------+
       | cron backups /      |
       | health scripts      |
       +---------------------+ 

## 9. Deployment & Delivery
Deployments are tag-based only. The documented flow is: merge to main, create release tag, deploy to UAT, validate, then deploy the same tag to production. UAT validation is required before production release. Deployment is manual rather than a fully automated continuous delivery pipeline.

+-------------------+      +----------------------+      +----------------------+ 
| GitHub            | ---> | GitHub Actions CI    | ---> | Manual release flow  |
+-------------------+      +----------------------+      +----------------------+ 

CI currently includes:
- npm ci
- prisma generate
- build
- tests
- prisma migrate status

Release flow:
- merge to main
- create tag
- deploy tag to UAT
- run E2E + k6
- if good, deploy same tag to production
- never deploy directly from main

## 10. Known Gaps / Not Fully Active
These exist in the model/docs but should not be treated as active architecture:
- waitlist auto-promotion flow
- no-show operational flow
- teacher workflows as fully production-ready
- fine-grained ADMIN vs MASTER_ADMIN split

## 11. Guiding Principles
Enforce rules on the server side. Use Product + Price as the catalog source of truth. Keep billing flows idempotent and reconciled through Stripe webhooks. Avoid duplicate domain logic across services and models.

## 12. One-line Summary
Your current system is a **Next.js App Router monolith** running behind **nginx + PM2**, using **Prisma + PostgreSQL**, with **Stripe** for payments, **Resend** for email, **Sentry** for monitoring, a **manual tag-only UAT -> production release flow**, and **local k6 load generation against UAT**.
                         |            NGINX                 |
                         |   TLS / reverse proxy / domain   |
                         +-----------------+----------------+
                                           |
                                           v
                         +----------------------------------+
                         |       Next.js App Router         |
                         |       Node runtime on PM2        |
                         |        app port = 3000           |
                         |       PM2 app = bookmyclass-app  |
                         +-----------------+----------------+
                                           |
                     +---------------------+----------------------+
                     |                                            |
                     v                                            v
         +---------------------------+              +-----------------------------+
         |   Route Handlers / APIs   |              |    Server Actions           |
         |   src/app/api/*           |              |    admin/dashboard paths    |
         +---------------------------+              +-----------------------------+
                     \                                            /
                      \                                          /
                       \                                        /
                        v                                      v
                         +----------------------------------+
                         |    Domain Services (src/lib/*)   |
                         |----------------------------------|
                         | auth                            |
                         | public-booking                  |
                         | subscription                    |
                         | dashboard                       |
                         | admin                           |
                         | marketing / client messages     |
                         | observability / security        |
                         +-----------------+----------------+
                                           |
                                           v
                         +----------------------------------+
                         |       Prisma + PostgreSQL        |
                         |      persistence / source        |
                         +-----------------+----------------+
                                           |
                                           v
                         +----------------------------------+
                         |       PostgreSQL database        |
                         |        (Docker on server)        |
                         +----------------------------------+

## Application Structure

======================================================================
3) FRONTEND STRUCTURE
======================================================================

The app is a Next.js App Router monolith with server components, client
components, route handlers, and server actions. Route groups include
(public), (protected), admin, api, auth, m, and teacher. :contentReference[oaicite:7]{index=7} :contentReference[oaicite:8]{index=8}

+----------------------------------------------------------------------------------+
| src/app                                                                          |
|----------------------------------------------------------------------------------|
| (public)     -> home, about, book-a-class, subscription, learning               |
| (protected)  -> customer dashboard, bookings, membership, profile               |
| admin        -> /admin sign-in + /admin/(private) back office                   |
| api          -> booking, subscription, checkout, webhook, health, catalogue     |
| auth         -> auth endpoints / flows                                           |
| m            -> extra route group                                                |
| teacher      -> exists, but enforcement/workflows not fully confirmed            |
+----------------------------------------------------------------------------------+

======================================================================
4) MAIN BUSINESS FLOWS
======================================================================

A) AUTH / IDENTITY
------------------
Client/Admin
   -> sign up / sign in
   -> pending registration + email verification
   -> credentials auth
   -> JWT session
   -> protected routes / admin gates

                        +-------------+
                        |   Browser   |
                        +------+------+
                               |
                               v
                    +-----------------------+
                    | Auth pages / handlers |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    | auth services         |
                    | - registration        |
                    | - verification        |
                    | - password reset      |
                    | - email change        |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    | User / Session /      |
                    | PendingRegistration / |
                    | VerificationToken     |
                    +-----------------------+

Confirmed auth stack:
- NextAuth v5 beta
- credentials provider
- Prisma adapter
- JWT strategy
- requireVerifiedUser for customer protected routes
- requireAdminSession for admin routes
:contentReference[oaicite:9]{index=9}

B) PUBLIC BROWSING -> BOOKING FLOW
----------------------------------
Client
  -> browse categories/services/availability
  -> create booking draft
  -> load payment options
  -> apply plan / entitlement or open Stripe checkout
  -> success page reconciliation
  -> booking finalized

+---------+    +------------------+    +--------------------+
| Client  | -> | Public catalogue | -> | Availability APIs  |
+---------+    +------------------+    +--------------------+
                                              |
                                              v
                                     +--------------------+
                                     | POST /bookings/    |
                                     | draft              |
                                     +--------------------+
                                              |
                                              v
                                     +--------------------+
                                     | payment-options    |
                                     | apply-plan         |
                                     +--------------------+
                                              |
                         +--------------------+--------------------+
                         |                                         |
                         v                                         v
              +------------------------+               +------------------------+
              | Existing entitlement   |               | Stripe checkout        |
              | immediate confirmation |               | order/payment/session  |
              +-----------+------------+               +-----------+------------+
                          |                                        |
                          +--------------------+-------------------+
                                               |
                                               v
                                     +---------------------------+
                                     | webhook + success-page    |
                                     | reconciliation            |
                                     +---------------------------+
                                               |
                                               v
                                     +---------------------------+
                                     | Booking + Payment +       |
                                     | Entitlement state         |
                                     +---------------------------+

Confirmed active flow; waitlist promotion and no-show are modeled but not
confirmed as active runtime flows. :contentReference[oaicite:10]{index=10} :contentReference[oaicite:11]{index=11}

C) SUBSCRIPTION / PRODUCT CHECKOUT FLOW
---------------------------------------
Important rule:
- catalog is Product + Price driven
- subscription page is not limited to recurring only
- Stripe mode is derived from Product/Price
:contentReference[oaicite:12]{index=12} :contentReference[oaicite:13]{index=13}

+---------+    +---------------------+    +-----------------------------+
| Client  | -> | /subscription page  | -> | Active Product + Price      |
+---------+    +---------------------+    +-----------------------------+
                                                     |
                                                     v
                                      +------------------------------+
                                      | POST /api/subscription/      |
                                      | checkout                     |
                                      +------------------------------+
                                                     |
                                                     v
                                              +-------------+
                                              |   Stripe    |
                                              +------+------+ 
                                                     |
                                                     v
                                      +------------------------------+
                                      | webhook + success            |
                                      | reconciliation               |
                                      +------------------------------+
                                                     |
                                                     v
                                      +------------------------------+
                                      | Order / Payment /            |
                                      | SubscriptionContract /       |
                                      | ClientEntitlement            |
                                      +------------------------------+

D) ADMIN FLOW
-------------
Admin / Master Admin
  -> /admin
  -> admin private routes
  -> server actions
  -> admin-service + other domain services
  -> DB mutations / redirects

+-------------------+    +----------------------+    +----------------------+
| Admin / Master    | -> | /admin sign-in       | -> | /admin/(private)     |
| Admin             |    | + role check         |    | pages                |
+-------------------+    +----------------------+    +----------+-----------+
                                                                      |
                                                                      v
                                                         +----------------------+
                                                         | Server Actions       |
                                                         | assertAdminAccess    |
                                                         +----------+-----------+
                                                                      |
                                                                      v
                                                         +----------------------+
                                                         | admin-service +      |
                                                         | domain services      |
                                                         +----------+-----------+
                                                                      |
                                                                      v
                                                         +----------------------+
                                                         | PostgreSQL           |
                                                         +----------------------+

## Integrations

======================================================================
5) EXTERNAL INTEGRATIONS
======================================================================

                         +----------------------------------+
                         |         EXTERNAL SERVICES        |
                         +----------------------------------+

   +-----------------+     +----------------+     +------------------+
   | Stripe          |     | Resend         |     | Sentry           |
   |-----------------|     |----------------|     |------------------|
   | checkout        |     | verification   |     | server/client/   |
   | billing portal  |     | password reset |     | edge monitoring  |
   | webhooks        |     | email sending  |     | sanitization     |
   +--------+--------+     +--------+-------+     +---------+--------+
            |                       |                         |
            +-----------+-----------+-------------------------+
                        |
                        v
               +----------------------+
               | Next.js monolith     |
               | src/lib integrations |
               +----------------------+

Stripe is central for checkout, billing portal, webhook verification, and
event processing. Local DB is updated through webhook/reconciliation paths. :contentReference[oaicite:14]{index=14}

## Data Architecture

======================================================================
6) DATA MODEL LAYERS
======================================================================

+----------------------------------------------------------------------------------+
| AUTH / IDENTITY                                                                  |
| User | Account | Session | VerificationToken | PendingUserRegistration |         |
| PasswordResetToken | rate-limit tables                                        |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| CATALOG / BILLING                                                                |
| Product | Price | EntitlementRule | Order | OrderItem | Payment |                |
| SubscriptionContract | ClientEntitlement                                         |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| SCHEDULING / BOOKINGS                                                            |
| ClassCategory | ClassType | ClassTemplate | RecurringRule | StudioSession |      |
| Booking | BookingPolicy | WaitlistEntry | AttendanceRecord                       |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| LEDGERS / SUPPORT / OPERATIONS                                                   |
| CreditLedgerEntry | LoyaltyLedgerEntry | AuditLog | AdminNote |                  |
| ContactMessage | ClientMessage | PublicDocument                                  |
+----------------------------------------------------------------------------------+

Important domain shape:
- bookings target sessions
- every booking must be backed by a valid entitlement
- credits and loyalty are immutable ledgers
- historical payment/order/subscription data must be preserved
:contentReference[oaicite:15]{index=15} :contentReference[oaicite:16]{index=16}

## Operations & Observability

======================================================================
7) OBSERVABILITY / OPERATIONS
======================================================================

                         +----------------------------------+
                         |        OBSERVABILITY LAYER       |
                         +----------------------------------+

       +---------------------+   +--------------------+   +-------------------+
       | /api/health         |   | Sentry             |   | PM2 status/logs   |
       | DB readiness        |   | app monitoring     |   | process health    |
       +---------------------+   +--------------------+   +-------------------+

       +---------------------+   +--------------------+   +-------------------+
       | Uptime Kuma         |   | Healthchecks       |   | Netdata           |
       | uptime/page checks  |   | backup heartbeat   |   | host metrics      |
       +---------------------+   +--------------------+   +-------------------+

       +---------------------+
       | cron backups /      |
       | health scripts      |
       +---------------------+

Confirmed:
- `/api/health`
- Sentry
- Uptime Kuma
- Healthchecks
- Netdata
- documented health and backup cron
- no in-app worker/queue service found
:contentReference[oaicite:17]{index=17} :contentReference[oaicite:18]{index=18}

## Environments

======================================================================
8) ENVIRONMENTS
======================================================================

+----------------------------------------------------------------------------------+
| LOCAL                                                                            |
|----------------------------------------------------------------------------------|
| Developer machine                                                                |
| - unit/integration tests                                                         |
| - E2E dev runs                                                                   |
| - k6 load testing                                                                |
| - local docker-compose includes postgres only                                    |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| UAT                                                                              |
|----------------------------------------------------------------------------------|
| Separate Hetzner VM                                                              |
| - same architecture as production                                                |
| - Stripe test mode                                                               |
| - pre-release validation                                                         |
| - E2E tests                                                                      |
| - webhook validation                                                             |
| - load testing                                                                   |
| - deploy/verify/reset/scale on host                                              |
| - k6 load generated locally, not on the UAT host                                 |
+----------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------+
| PRODUCTION                                                                       |
|----------------------------------------------------------------------------------|
| Hetzner VM                                                                       |
| - public domain                                                                  |
| - real Stripe mode                                                               |
| - real users                                                                     |
| - exact host topology still needs operator confirmation                          |
+----------------------------------------------------------------------------------+

Canonical environment split and UAT testing role are explicitly documented. :contentReference[oaicite:19]{index=19} :contentReference[oaicite:20]{index=20}

## Deployment & Delivery

======================================================================
9) CI / DELIVERY
======================================================================

+-------------------+      +----------------------+      +----------------------+
| GitHub            | ---> | GitHub Actions CI    | ---> | Manual release flow  |
+-------------------+      +----------------------+      +----------------------+

CI currently includes:
- npm ci
- prisma generate
- build
- tests
- prisma migrate status

Release flow:
- merge to main
- create tag
- deploy tag to UAT
- run E2E + k6
- if good, deploy same tag to production
- never deploy directly from main
:contentReference[oaicite:21]{index=21} :contentReference[oaicite:22]{index=22} :contentReference[oaicite:23]{index=23}

======================================================================
10) CURRENT GAPS THAT SHOULD NOT BE DRAWN AS "ACTIVE"
======================================================================

These exist in the model/docs but should not be treated as active architecture:
- waitlist auto-promotion flow
- no-show operational flow
- teacher workflows as fully production-ready
- fine-grained ADMIN vs MASTER_ADMIN split
:contentReference[oaicite:24]{index=24}

## One-line Summary

======================================================================
11) ONE-LINE SUMMARY
======================================================================

Your current system is a **Next.js App Router monolith** running behind
**nginx + PM2**, using **Prisma + PostgreSQL**, with **Stripe** for payments,
**Resend** for email, **Sentry** for monitoring, a **manual tag-only UAT ->
production release flow**, and **local k6 load generation against UAT**. :contentReference[oaicite:25]{index=25} :contentReference[oaicite:26]{index=26} :contentReference[oaicite:27]{index=27}
