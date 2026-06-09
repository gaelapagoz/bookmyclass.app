# Product Overview

This is a boutique fitness studio web platform with booking, subscriptions, learning, commerce, admin tooling.

At a high level, it combines:

* public marketing website
* booking engine
* subscription and entitlement management
* store for merchandise and gift cards
* coupons
* learning platform
* admin backoffice
* operational tooling
* production infrastructure and deployment workflows

## User Roles

The platform currently supports four roles:

* CLIENT
* TEACHER
* ADMIN
* MASTER_ADMIN

## Client Experience

Clients can:

* browse public pages
* view classes and availability
* create an account and manage profile/security
* buy subscriptions, packs, and memberships
* book classes through entitlement-aware flows
* buy merchandise and gift cards
* redeem coupons and gift cards
* access a personal dashboard
* manage subscriptions through the Stripe billing portal
* watch learning videos
* contact support

The booking flow includes:

* booking drafts
* payment option selection
* use of ticket packs, memberships, or credits
* checkout via Stripe
* webhook reconciliation
* cancellation handling
* waitlist support

## Subscription & Commerce Model

The commerce model is based on Products and Prices.

Products include:

* unlimited monthly memberships
* drop-in sessions
* collective class packs
* private class packs
* merchandise items
* gift cards

The platform supports:

* recurring subscription billing
* ticket validity windows
* credit expiration
* multiple payment options
* coupon support

## Admin Capabilities

The admin area acts as a full operational control center for the studio. Admins can manage nearly every business domain, including:

* users and permissions
* classes and schedules
* recurring sessions
* teachers
* subscriptions and entitlements
* products and pricing
* learning content
* inbox and contact requests
* marketing campaigns
* credits
* documents and public assets
* support notes and audit logs
* waitlists and no-show handling

## Teacher Capabilities

Teacher-related functionality includes:

* visibility into sessions
* profile management
* attendance-related data models
* waitlists and no-show handling

## Technical Architecture

The platform is built as a monolith using:

* Next.js App Router
* React
* TypeScript
* Prisma
* PostgreSQL

Infrastructure includes:

* nginx reverse proxy
* PM2 runtime management
* Docker-managed database services
* TLS via certbot
* separate dev, staging, and production environments

## External Integrations

The app integrates with several external services:

* Stripe for payments and subscriptions
* Resend for emails and notifications
* Sentry for runtime monitoring
* Uptime Kuma for availability checks
* Healthchecks for backup and cron monitoring
* Backblaze for optional offsite backups
* Netdata for server metrics

## CI/CD and Quality

The platform has nominal release process. The delivery flow includes:

1. Merge to main
2. Create a release tag
3. Deploy to staging
4. Run testing and health validation
5. Promote the exact same tag to production

Testing currently includes:

* unit tests
* integration tests
* UI tests
* E2E tests
* performance tests
* security tests

The stack includes:

* Vitest
* Playwright
* k6
* OWASP ZAP

## Operations

The platform supports the following operational capabilities: already quite advanced.

* health endpoints
* PM2 monitoring
* Sentry monitoring
* uptime monitoring
* scheduled health checks
* nightly database backups
* rollback procedures
* release validation
* load testing
* security scanning

## Repository Structure

```
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

## Local Setup

1. Install dependencies:
```bash
npm ci
```

2. Start PostgreSQL (local default):
```bash
docker compose up -d postgres
```

3. Create `.env` from the variables documented in [docs/40_02_environment_variables.md](docs/40_02_environment_variables.md). No `.env.example` is committed. Critical production-required vars: `AUTH_SECRET`, `DATABASE_URL`, `APP_URL`, `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `UPLOADS_DIR`.

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

## Local Email Dispatch

Canonical email delivery remains outbox/dispatcher based in local development.
Activating an automation template in Admin only allows new events to enqueue; it does not send mail by itself.

For real localhost delivery, set these variables in `.env.local`:

```bash
APP_URL=http://localhost:3000
EMAIL_FROM="BookMyClass <no-reply@bookmyclass.app>"
RESEND_API_KEY=...
ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1
CRON_SECRET=local-dev-secret
```

Then use:

```bash
npm run email:verify
npm run email:dispatch:local
```

Or hit the canonical maintenance route:

```bash
curl -H "Authorization: Bearer local-dev-secret" http://127.0.0.1:3000/api/cron/maintenance
```

Without `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1`, local email events still move through the outbox but provider delivery is intentionally suppressed.

## Testing And Validation

**E2E setup:** E2E tests require a dedicated `.env.e2e` file (see `.env.e2e.example` and [docs/30_04_e2e_setup.md](docs/30_04_e2e_setup.md)). Required values include `E2E_TEST_MODE=1`, `E2E_TEST_SECRET`, a dedicated `DATABASE_URL`, and all `STRIPE_PRICE_ID_STORE_*` vars. Run `npm run db:e2e:setup` before the first run.

Run tests:
```bash
npm test -- --run
npm run test:e2e
npm run test:e2e:install
npm run test:staging:smoke
npm run test:e2e:staging
```
Staging command aliases intentionally reuse existing `UAT_*` configuration for
GitHub compatibility (`test:staging:smoke` -> `test:uat:smoke`,
`test:e2e:staging` -> `test:e2e:uat`).
For CI Linux runners, install Playwright Chromium with system dependencies:
```bash
npm run test:e2e:install:deps
```
Run performance tests:
```bash
BASE_URL=https://demo.bookmyclass.app bash scripts/performance-server-run-smoke.sh
```
Run security tests:
```bash
docker run --rm -v "$(pwd -W):/zap/wrk/:rw" -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t https://demo.bookmyclass.app \
  -r zap-baseline-report.html \
  -d
```

## Planner Auditor Loop (Local Workflow)

Local operator workflow files live in `.codex-workflows/`:

- `.codex-workflows/planner.md`
- `.codex-workflows/auditor.md`
- `.codex-workflows/planner-auditor-loop.sh`

The loop uses `.codex/agents/planner.md` and `.codex/agents/auditor.md` as primary agent definitions, and treats `.codex-workflows/planner.md` + `.codex-workflows/auditor.md` as thin loop overlays (non-duplicative).

Run the loop with a feature context markdown file:

```bash
bash .codex-workflows/planner-auditor-loop.sh path/to/feature-context.md
```

Optional overrides:

```bash
# change runner command (must read prompt from stdin, write response to stdout)
# runner executable (script invokes: <runner> exec --output-last-message ...)
CODEX_RUNNER="codex" bash .codex-workflows/planner-auditor-loop.sh path/to/feature-context.md

# lower round cap (must be 1-5)
bash .codex-workflows/planner-auditor-loop.sh path/to/feature-context.md 3
```

Run artifacts are stored per execution at:

```bash
.codex-workflows/runs/<timestamp>/
```

Each round saves planner and auditor prompts/outputs. The loop stops when the auditor ends with `VERDICT: APPROVED` or after 5 rounds.

## Developer Reviewer Security QA Loop (Local Workflow)

Local operator workflow files live in `.codex-workflows/`:

- `.codex-workflows/developer.md`
- `.codex-workflows/reviewer.md`
- `.codex-workflows/security-reviewer.md`
- `.codex-workflows/qa.md`
- `.codex-workflows/developer-review-security-qa-loop.sh`

The loop uses `.codex/agents/developer.md`, `.codex/agents/reviewer.md`, `.codex/agents/security-reviewer.md`, and `.codex/agents/qa.md` as primary definitions. The `.codex-workflows/*.md` files are thin loop overlays.

Run the loop with a feature context markdown file:

```bash
bash .codex-workflows/developer-review-security-qa-loop.sh path/to/feature-context.md
```

Optional overrides:

```bash
# runner executable (script invokes: <runner> exec --output-last-message ...)
CODEX_RUNNER="codex" bash .codex-workflows/developer-review-security-qa-loop.sh path/to/feature-context.md

# lower round cap (must be 1-5)
bash .codex-workflows/developer-review-security-qa-loop.sh path/to/feature-context.md 3
```

Run artifacts are stored per execution at:

```bash
.codex-workflows/runs/<timestamp>/
```

Each round saves developer/reviewer/security-reviewer/qa prompts and outputs. The loop stops when reviewer, security reviewer, and QA all end with `VERDICT: APPROVED`, or after 5 rounds.

## Store and Gift Card

Store browsing, merchandise checkout, gift-card purchase, and gift-card redemption are active canonical runtime flows. They are not gated by rollout feature flags. Operational readiness depends on a correctly seeded catalog (Products + Prices with `StripeSyncStatus.SYNCED`) and `CRON_SECRET` protecting the gift-card maintenance route.

## Admin Products (Plans)

The admin area manages subscription and class products at `/admin/plans`. The UI labels this section **Products**. Admins can create, edit, and deactivate products and prices from this screen; Stripe sync is handled via `npm run stripe:catalog:sync`.

## Documentation Index

Canonical runtime truth lives in the `docs/00_*` files — consult these first for deployment, environment, and architecture decisions.

* 10_*: business and domain rules.
* 20_*: architecture and engineering implementation boundaries.
* 30_*: testing standards and e2e scope.
* 40_*: CI/CD, environment, release, and operations references.
* 50_*: setup and runbook procedures.
* 60_*: security and compliance-oriented technical references.
* 70_*: third-party/service integrations.
* 90_*: AI workflow and execution guardrails.
