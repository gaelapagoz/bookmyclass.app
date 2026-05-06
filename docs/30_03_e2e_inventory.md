# E2E Inventory (Production-Critical)

This inventory defines the local Playwright coverage matrix for active, launch-relevant runtime flows.

## Scope Rules

- Use current code as the primary source of truth.
- Include active public, customer, admin, teacher, and cross-app flows that are deterministic enough for local Playwright.
- Exclude roadmap, operator-only, UAT-only, manual runbook, and schema-only behavior.
- Do not add `@covers` tags unless a spec genuinely exercises the matrix item.
- Keep no-show runtime operations out of the matrix until active runtime code exposes a deterministic flow.
- Keep broad spam/rate-limit behavior out of the matrix unless the specific flow is deterministic and low-maintenance in E2E.

## Matrix Source

The executable matrix lives in `qa/e2e-coverage-matrix.json`.

Each item has:

- stable `id`
- `area`: `public`, `customer`, `admin`, `teacher`, or `cross`
- `risk`: `critical`, `high`, `medium`, or `low`
- `description`

Coverage tags are parsed from `test/e2e/**/*.spec.ts` by `scripts/e2e-coverage-report.ts`.

## Active Matrix Areas

### Public

- Homepage entry points.
- Public class catalogue.
- Public service detail and availability.
- Public learning catalogue/course preview with anonymous video gate.
- Public contact form submit.

### Customer

- Sign up, email verification, sign in, and protected dashboard guard.
- Booking draft, payment options, existing-entitlement confirmation, Stripe checkout, success reconciliation, and confirmation screens.
- Subscription/product catalogue, cart checkout, success reconciliation, membership state, and billing portal initiation.
- Dashboard booking and membership state.
- Booking cancellation before and after cutoff.
- Waitlist join/cancel from customer UI.
- Dashboard self check-in.
- Password reset initiation and single-use token completion.
- Profile page.
- Customer block from staff kiosk routes.

### Admin

- Staff sign-in, private-route guard, and non-admin denial.
- Dashboard and operational list pages.
- User, service/class, and session create/update flows.
- Booking, plan/product, subscription, online learning, inbox, and marketing surfaces.
- Kiosk access and attendance finalization.
- Read-only waitlist count visibility.
- Manual attendee add for eligible clients.
- Audited manual no-credit attendee override.

### Teacher

- Teacher route guard for anonymous/client users.
- Teacher sign-in and route access.
- DB-backed teacher access revocation.
- Assigned sessions calendar and session roster detail.
- Assigned-session roster mutation.
- Cross-teacher session boundary enforcement.
- Read-only waitlist count visibility.
- Staff attendance marking.
- Kiosk check-in, check-in-window blocks, private-class exclusion, exit password re-entry, and exit lockout.
- Profile page.

### Cross-App

- Duplicate active booking safety.
- Ineligible entitlement application rejection.
- Payment failure and expired checkout safe outcomes.
- Stripe reconciliation and webhook-backed final state visibility.
- Cancellation policy enforcement.
- Password reset security flow.
- Health endpoint readiness.

## Current Partial Coverage

These matrix items are intentionally partial because the existing deterministic specs cover the launch-relevant surface but not full CRUD/provider behavior:

- `public-service-detail-availability`: covered through booking journeys that open a service detail and use available slots.
- `customer-billing-portal-access`: covered through portal initiation UI, not a real Stripe portal round trip.
- `admin-user-edit-persists`: covered through teacher user creation, not every edit variant.
- `admin-marketing-campaign-draft-flow`: covered through deterministic confirm/send outcome, not full campaign authoring.
- `admin-online-learning-crud`: covered by admin learning surface load, not full program/video CRUD.

## Intentionally Excluded

- No-show runtime workflow: modeled, not active as an end-to-end operational flow.
- General spam/rate-limit matrix item: rate limits exist, but broad E2E coverage would be high-churn unless scoped to a deterministic flow such as kiosk exit lockout.
- UAT release checks and operator runbook tasks.
- Historical teacher/waitlist/manual items not backed by active runtime code.
- Schema-only capabilities without active route/action/service usage.
