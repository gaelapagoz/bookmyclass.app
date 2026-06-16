# S1 Production Defect Remediation Plan

This file is the implementation source of truth for the approved S1 remediation work.

It replaces the earlier loose workstream outline with a plan that is safe against:
- cross-domain email dispatcher regressions
- stale template-key cleanup
- localhost/loopback URL leakage
- auth/header verified-state drift
- timezone/DST round-trip errors
- accidental activation of modeled reminder behavior

## 1. Alignment Verdict

Aligned after the corrections in this file.

The previous draft was only partially aligned because it:
- proposed a shared dispatcher hydrator that was broader than the proven defect scope
- treated stale-session redirect rewriting as the main URL-safety fix instead of fixing the canonical `APP_URL` source and waitlist URL builders
- removed a payment template key before proving the DB/runtime migration path
- mixed modeled reminder behavior into the active defect scope without a runtime schedule contract

## 2. Canonical Constraints

Authoritative docs reviewed for this plan:
- `docs/00_01_system_baseline.md`
- `docs/00_02_deployment_baseline.md`
- `docs/10_01_business_rules.md`
- `docs/10_02_domain_rules.md`
- `docs/20_02_service_boundaries.md`
- `docs/30_01_testing_rulebook.md`

Rules this plan must preserve:
- business logic stays in `src/lib/*`
- routes and server actions orchestrate only
- validate before mutate
- production boot/runtime must remain safe
- no destructive production reset/seed
- do not treat modeled capabilities as active unless the baseline confirms them
- code, tests, comments, fixtures, and documentation must use functional names and descriptions, not roadmap labels such as `Slice X`, `Phase Y`, or similar plan references

Active-vs-modeled decision for this feature:
- Admin -> Automations is active and configurable.
- Waitlist and booking transactional automations are active.
- Class reminder automation is modeled/scaffolded only unless this plan explicitly activates it through the existing cron/outbox architecture.
- Subscription reminder automation remains modeled and out of scope here.

## 3. Goal

Fix the currently observed S1 defects with minimal, surgical changes across:
1. URL and runtime env safety
2. transactional email payload correctness
3. auth/header verified-state consistency
4. admin session timezone round-trip correctness
5. automations scaffold/admin cleanup

This is not an email-platform redesign.

## 4. Explicit Non-Goals

Do not do any of the following in this plan:
- no universal dispatcher hydrator for every template family
- no new queue, worker, scheduler, or cron subsystem
- no new rollout toggles for email architecture
- no destructive cleanup of production template rows
- no removal of a runtime template key without a migration/backfill path
- no reminder activation until schedule, timezone basis, and dedupe rules are approved in-plan
- no third booking-confirmation email path
- no broad nav/auth rewrite beyond the verified-state contract needed for the defect

## 4.1 Naming Rule

Roadmap/planning language must not leak into implementation artifacts.

This applies to:
- source code comments
- test file names
- `describe` and `it` titles
- fixture names
- seeded labels
- admin/UI copy
- active documentation

Disallowed examples:
- `Slice 4 idempotency`
- `Phase 2 reminder flow`
- `former Slice B product`

Required approach:
- use the actual functional description instead
- name things by runtime behavior, domain purpose, or user-visible outcome

Approved examples:
- `gift-card rate limits`
- `booking/waitlist payload hydration`
- `payment purchase confirmation template key reconciliation`
- `admin session timezone round-trip`

Exception:
- historical roadmap files may still use slice/phase language because they are planning artifacts, but implementation code, tests, and active docs must not.

## 5. Confirmed Repo Facts

The plan must respect these current facts from source:
- `src/lib/public-booking/waitlist-notification-service.ts` still falls back to `http://localhost:3000` when `APP_URL` is missing.
- `src/lib/config/runtime-env-server.ts` does not currently require `APP_URL` in production validation.
- `src/app/auth/stale-session/route.ts` already sanitizes callback paths with `getSafeCallbackPath`, but still builds an absolute redirect from `request.url`.
- `src/lib/auth/require-auth.ts` fail-closes for missing/inactive users, but does not explicitly fail closed on Prisma/schema/DB lookup failures in `requireVerifiedUser`.
- `src/components/Navbar.tsx` currently derives authenticated state from JWT/session presence only.
- `src/lib/email/email-automation-dispatcher-service.ts` renders tokens directly from persisted payload JSON and replaces missing values with empty strings.
- `src/lib/email/email-automation-admin-service.ts` still scaffolds both `purchase.product.confirmation` and `payment.purchase.confirmation`.
- `src/app/api/cron/maintenance/route.ts` currently runs waitlist-not-promoted enqueue, booking-confirmation reconciliation, and dispatcher batch, but does not schedule class reminders.
- `docs/10_01_business_rules.md` defines the cancellation rule as 24 hours before class start.

## 6. Documentation Conflicts

Conflicts found:
- `docs/00_01_system_baseline.md` says Automations is active/configurable.
- `docs/20_01_architecture_overview.md` still describes Automations as placeholder-only.

Authority:
- Use `00_01_system_baseline.md`.

Required correction outside this plan's code scope:
- update `docs/20_01_architecture_overview.md` after implementation or in a docs-only follow-up so it no longer contradicts the baseline.

## 7. Implementation Order Overview

Implement this plan strictly in the slice order below.

This plan is split into seven execution slices. Slice 1 is required and safe to start immediately.

### Slice 1: inventory and decision capture
Purpose:
- prove the exact runtime/template/url surfaces before code changes

Deliverables:
- template-key inventory
- runtime producer inventory
- URL-builder inventory
- idempotency/dedupe inventory
- reminder-scope decision

### Slice 2: shared URL source safety
Purpose:
- eliminate localhost/loopback leakage from active user-facing URLs

Deliverables:
- canonical `APP_URL` validation helper and production enforcement
- waitlist/manage-link fix
- stale-session redirect cleanup aligned with host-safe relative redirects

### Slice 3: payment/store template-key reconciliation
Purpose:
- choose the canonical payment purchase template key safely and preserve existing DB/admin references

Deliverables:
- canonical key decision
- migration/backfill/compatibility path
- scaffold/admin list cleanup only after reconciliation

### Slice 4: booking/waitlist email payload correctness
Purpose:
- fix booking/waitlist transactional tokens without changing unrelated payment/store/gift-card payload semantics

Deliverables:
- booking/waitlist-specific payload enrichment
- required-token validation boundaries
- dead-letter behavior for missing required tokens

### Slice 5: verified-state auth/header consistency
Purpose:
- keep customer account affordances aligned with verified server state, not stale JWT presence

Deliverables:
- `requireVerifiedUser` fail-closed DB error behavior
- stale-session cleanup integration
- navbar/account affordance correction

### Slice 6: timezone round-trip correctness
Purpose:
- make admin session edit display/save preserve the intended site-timezone instant across DST boundaries

Deliverables:
- site-timezone `datetime-local` rendering/parsing
- explicit timezone-required runtime helpers
- DST-focused tests

### Slice 7: optional reminder activation
Purpose:
- only if explicitly approved after Slice 1 inventory

Deliverables:
- exact reminder schedule
- timezone basis
- idempotency/dedupe rule
- existing cron/outbox enqueue path only

If Slice 1 cannot prove the exact runtime reminder contract, Slice 7 is deferred out of this plan.

### Implementation sequence at a glance
1. Slice 1 proves the exact active runtime/template/url surfaces and decides whether reminders stay deferred.
2. Slice 2 fixes the shared URL source and production `APP_URL` safety.
3. Slice 3 reconciles payment/store template keys before any cleanup removes or hides live rows.
4. Slice 4 fixes booking/waitlist payload correctness within the narrow booking/waitlist scope.
5. Slice 5 aligns verified customer state across route protection, stale-session cleanup, and header affordances.
6. Slice 6 fixes admin session timezone round-tripping and DST correctness.
7. Slice 7 is optional and runs only if Slice 1 explicitly approves reminder activation.

## 8. Slice 1: Inventory And Decisions

This slice is mandatory before any runtime mutation logic changes.

### 8.1 Template-key inventory

Create a written inventory of:
- every `EmailTemplate.templateKey` scaffolded in `email-automation-admin-service.ts`
- every runtime producer that enqueues that key
- every admin/UI test that expects that key
- any DB migration/backfill implications if a key is renamed, merged, or removed

Minimum keys to explicitly classify:
- `purchase.product.confirmation`
- `payment.purchase.confirmation`
- `store.purchase.confirmation`
- `booking.class-booked`
- `booking.class-cancelled`
- `booking.class-reminder`
- `waitlist.on-list`
- `waitlist.promoted`
- `waitlist.not-promoted`

Required output:
- `active runtime producer`
- `admin scaffold only`
- `legacy alias requiring migration`
- `modeled only`

Slice 1 inventory result:

| Template key | Classification | Runtime producer inventory | Admin/UI and test expectations | Migration/backfill implication |
| --- | --- | --- | --- | --- |
| `purchase.product.confirmation` | `legacy alias requiring migration` | No active runtime producer found in `src/lib/*` or route/server-action search. Present only in `src/lib/email/email-automation-admin-service.ts` scaffold list and `src/lib/email/email-template-token-registry.ts` payment-family alias map. | `test/ui/admin-pages.ui.test.tsx` expects the scaffold row. | Do not delete blindly. `EmailTemplate.templateKey` is unique and persisted DB rows may already exist under this key. Cleanup requires a DB row migration or a read-time compatibility alias before scaffold/test removal. |
| `payment.purchase.confirmation` | `active runtime producer` | `src/lib/email/purchase-confirmation-email.ts` enqueues it through `src/lib/email/lifecycle-email-outbox-service.ts`; `src/lib/fulfillment/order-fulfillment-service.ts` is the live caller. | `test/ui/admin-pages.ui.test.tsx`, `test/unit/purchase-confirmation-email.unit.test.ts`, `test/integration/email-idempotency.integration.test.ts`. | This is the safe canonical payment key because active runtime already emits it. Future reconciliation must migrate legacy admin/DB rows onto this key rather than creating a second payment path. |
| `store.purchase.confirmation` | `active runtime producer` | `src/lib/email/store-email.ts` enqueues it through `src/lib/email/lifecycle-email-outbox-service.ts`; `src/lib/fulfillment/order-fulfillment-service.ts` is the live caller. | `test/ui/admin-pages.ui.test.tsx`, `test/integration/email-idempotency.integration.test.ts`, `test/integration/store-emails.integration.test.ts`. | No rename pressure found in Slice 1. Preserve current key and producer path. |
| `booking.class-booked` | `active runtime producer` | `src/lib/public-booking/booking-confirmation-transition-service.ts` enqueues/reconciles the outbox event; `src/lib/public-booking/booking-confirmation-notification-service.ts` exposes the shared idempotency key builder; `src/lib/public-booking/booking-payment-options-service.ts` ensures the template exists before immediate existing-credit confirmation. | `test/ui/admin-pages.ui.test.tsx`, `test/integration/booking-payment-options-api.integration.test.ts`, `test/integration/waitlist-service.integration.test.ts`, `test/integration/stripe-webhook.integration.test.ts`, `test/integration/stripe-webhook-api.integration.test.ts`, `test/integration/admin-session-attendee-management.integration.test.ts`. | No key rename proposed in Slice 1. Later payload work must reuse the current confirmation/reconciliation path, not add a third producer. |
| `booking.class-cancelled` | `active runtime producer` | `src/lib/public-booking/booking-confirmation-transition-service.ts` queues the cancellation event; callers include `src/lib/dashboard/dashboard-service.ts` and `src/lib/admin/admin-booking-core-service.ts`. | `test/ui/admin-pages.ui.test.tsx`, `test/integration/dashboard-service.integration.test.ts`. | No rename proposed in Slice 1. Preserve current key and queue path. |
| `booking.class-reminder` | `modeled only` | No enqueue function, no cron wiring, and no active runtime producer found. Present only in `src/lib/email/email-automation-admin-service.ts` scaffold defaults and `src/lib/email/email-template-token-registry.ts`. | `test/ui/admin-pages.ui.test.tsx` expects the scaffold row only. | Keep scaffolded but inactive. No runtime activation until a later slice proves schedule, timezone basis, and dedupe rules. |
| `waitlist.on-list` | `active runtime producer` | `src/lib/public-booking/waitlist-notification-service.ts` enqueues it; `src/lib/public-booking/waitlist-service.ts` is the live caller after join/reactivation flows. | `test/ui/admin-pages.ui.test.tsx`, `test/integration/waitlist-service.integration.test.ts`. | No rename proposed in Slice 1. Preserve current key and producer path. |
| `waitlist.promoted` | `active runtime producer` | `src/lib/public-booking/waitlist-notification-service.ts` enqueues it; live callers are `src/lib/dashboard/dashboard-service.ts` and `src/lib/admin/admin-booking-core-service.ts` after waitlist promotion results. | `test/ui/admin-pages.ui.test.tsx`, `test/integration/waitlist-service.integration.test.ts`, `test/integration/admin-session-attendee-management.integration.test.ts`. | No rename proposed in Slice 1. Preserve current key and promotion-trigger path. |
| `waitlist.not-promoted` | `active runtime producer` | `src/lib/public-booking/waitlist-notification-service.ts` scans/enqueues it; `src/app/api/cron/maintenance/route.ts` is the active scheduler entrypoint. | `test/ui/admin-pages.ui.test.tsx`, `test/integration/waitlist-service.integration.test.ts`, `test/integration/cron-maintenance-route.integration.test.ts`, `test/unit/cron-maintenance-route.unit.test.ts`. | No rename proposed in Slice 1. Preserve current key and maintenance-cron path. |

Slice 1 template-key decisions:
- Canonical payment purchase confirmation key: `payment.purchase.confirmation`.
- `purchase.product.confirmation` remains a legacy admin/DB compatibility concern until a later slice defines the migration/backfill path.

### 8.2 URL-builder inventory

Inventory every active URL builder in scope:
- auth stale-session redirect
- waitlist manage link
- auth verification email
- password reset email
- email-change verification email
- any checkout/auth links generated from `APP_URL`

For each URL builder, classify:
- relative path only
- absolute URL required
- currently uses `APP_URL`
- currently falls back to localhost

Slice 1 inventory result:

| URL builder | Classification | Current source | Current `APP_URL` usage | Localhost fallback status |
| --- | --- | --- | --- | --- |
| Auth stale-session redirect | relative path only | `src/app/auth/stale-session/route.ts` uses `getSafeCallbackPath` and builds `/sign-in?callbackUrl=...` from `request.url`. | Does not read `APP_URL`. | No localhost fallback; host comes from the incoming request URL. |
| Waitlist manage link | absolute URL required | `src/lib/public-booking/waitlist-notification-service.ts` builds `{{waitlist.manageUrl}}` for customer email payloads. | Reads `process.env.APP_URL?.trim()`. | Falls back to `http://localhost:3000`. This is an active production-risk surface. |
| Auth verification email | absolute URL required | `src/lib/auth/user-identity-service.ts` builds verification URLs for signup and resend flows. | Uses `resolveAppUrl(...)` from `src/lib/auth/auth-email-fast-lane-service.ts`. | `resolveAppUrl` falls back to `http://localhost:3000`, but production rejects loopback hosts. |
| Password reset email | absolute URL required | `src/lib/auth/password-service.ts` builds `/reset-password?token=...`. | Uses `resolveAppUrl(...)` from `src/lib/auth/auth-email-fast-lane-service.ts`. | `resolveAppUrl` falls back to `http://localhost:3000`, but production rejects loopback hosts. |
| Email-change verification email | absolute URL required | `src/lib/auth/user-identity-service.ts` builds `/verify-email?emailChangeToken=...`. | Uses `resolveAppUrl(...)` from `src/lib/auth/auth-email-fast-lane-service.ts`. | `resolveAppUrl` falls back to `http://localhost:3000`, but production rejects loopback hosts. |
| Checkout success/cancel and billing-portal return links | absolute URL required | `src/lib/public-booking/checkout-service.ts`, `src/lib/cart/cart-checkout-service.ts`, `src/app/api/subscription/checkout/route.ts`, and `src/app/api/subscription/portal/route.ts` rely on Stripe env helpers. | Uses `getStripeServerEnv().appUrl` from `src/lib/payments/stripe.ts`. | No localhost fallback in this helper; missing `APP_URL` is a hard failure. |

Slice 1 URL decision:
- The only in-scope active localhost fallback confirmed for customer-facing email links is the waitlist manage URL.
- Auth email flows already centralize `APP_URL` through `resolveAppUrl`, but they still rely on a dev fallback outside production.

### 8.3 Idempotency/dedupe inventory

Before reminder work or email payload normalization, inventory:
- waitlist join idempotency key
- waitlist promotion idempotency key
- waitlist not-promoted idempotency key
- booking confirmation enqueue reconciliation path
- any reminder candidate dedupe key

This is required so reminder scheduling does not duplicate sends around cron retries or session edits.

Slice 1 inventory result:

| Flow | Idempotency/dedupe contract | Source evidence | Notes |
| --- | --- | --- | --- |
| Waitlist join email | `waitlist-on-list:${waitlistEntryId}:joined-v1` | `src/lib/public-booking/waitlist-notification-service.ts` | `enqueueEmailAutomationEvent` plus unique `EmailAutomationEvent.idempotencyKey` deduplicates repeated join/reactivation enqueue attempts. |
| Waitlist promotion email | `waitlist-promotion:${waitlistEntryId}:${bookingId}` | `src/lib/public-booking/waitlist-notification-service.ts` | Promotion dedupe is tied to the promoted booking row, so cron retries or repeated post-promotion enqueue calls collapse onto one event. |
| Waitlist not-promoted email | `waitlist-not-promoted:${waitlistEntryId}:session-start-v1` | `src/lib/public-booking/waitlist-notification-service.ts`; scheduled by `src/app/api/cron/maintenance/route.ts` | Re-running maintenance cron after class start reuses the same event key for the same waitlist entry. |
| Booking confirmation enqueue reconciliation | `booking-confirmation:${bookingId}:confirmed-v1` | `src/lib/public-booking/booking-confirmation-notification-service.ts`; reused by `src/lib/public-booking/booking-confirmation-transition-service.ts` | This is the canonical dedupe contract for both immediate confirmation and missing-event reconciliation. |
| Booking cancellation email | `booking-cancelled:${bookingId}:cancelled-v1` | `src/lib/public-booking/booking-confirmation-transition-service.ts` | Not a required Slice 1 deliverable, but recorded because it shares the booking email outbox path. |
| Reminder candidate | none found | No enqueue path found in `src/lib/*`, `src/app/api/cron/maintenance/route.ts`, or tests. | There is no active dedupe rule because there is no active reminder producer yet. |

Slice 1 idempotency decision:
- Waitlist and booking confirmation flows already have concrete email dedupe contracts.
- Reminder activation remains blocked until a dedicated dedupe key and reschedule rule are defined.

### 8.4 Reminder scope decision

The plan must not assume class reminders are active.

Required explicit decision after inventory:
- `Deferred`: class reminders stay modeled; no runtime code added in this plan
- `Approved`: class reminders become active only after this plan records:
  - exact enqueue trigger
  - timezone basis
  - schedule offset
  - dedupe/idempotency rule
  - session-edit reschedule behavior
  - cancellation interaction

Default if not proven: `Deferred`.

Slice 1 decision: `Deferred`.

Evidence for deferral:
- `booking.class-reminder` exists only in the admin scaffold list and token registry.
- `src/app/api/cron/maintenance/route.ts` schedules waitlist not-promoted enqueue, booking-confirmation reconciliation, and email dispatcher batch, but no reminder enqueue.
- No reminder producer, no reminder cron trigger, no timezone basis, and no reminder dedupe key were found in source or tests.

Required facts still missing before any reminder activation:
- exact enqueue trigger location in active runtime code
- schedule offset aligned to the 24-hour cancellation rule in `docs/10_01_business_rules.md`
- timezone basis for “before class start”
- dedupe/idempotency key contract
- session-edit reschedule behavior
- cancellation and expired-session suppression behavior

## 9. Slice 2: Shared URL Source Safety

### 9.1 Canonical helper

Add a shared server-side helper in `src/lib/config/*` that:
- requires `APP_URL` when an absolute URL is needed
- rejects loopback/localhost origins in production
- returns a normalized absolute origin for active runtime callers

This helper is the source of truth for:
- waitlist manage links
- auth/provider-generated absolute links
- future automation links in this domain

### 9.2 Production validation

Update runtime env validation so production requires:
- `APP_URL`
- non-empty
- parseable absolute URL
- non-loopback host in production

Safety requirement:
- `src/lib/config/runtime-env-server.ts` remains the canonical production validator.
- `src/lib/config/runtime-env.ts` must continue delegating to that validator unchanged.
- `src/app/api/health/route.ts` must keep exercising the validator so bad production env is observable.
- `src/lib/payments/stripe.ts` and any in-scope absolute-URL caller must resolve `APP_URL` through the canonical validated path, not a raw fallback.
- before making boot/runtime validation hard-fail, record an explicit operator env audit for UAT and production in the implementation handoff.

### 9.3 Stale-session route

Do not treat stale-session as the primary URL safety fix.

Instead:
- keep callback-path sanitization via `getSafeCallbackPath`
- switch the redirect target to a host-preserving relative sign-in redirect
- preserve cookie clearing behavior

The route must not generate localhost redirects in production.

### 9.4 Waitlist links

Replace localhost fallback in `waitlist-notification-service.ts` with the canonical helper.

No user-facing waitlist email in production may contain:
- `localhost`
- `127.0.0.1`
- loopback/private dev origins

## 10. Slice 3: Payment/Store Template-Key Reconciliation

### 10.1 Decision requirement

Pick one canonical payment purchase confirmation key.

Recommended canonical key:
- `payment.purchase.confirmation`

Reason:
- it is clearer than `purchase.product.confirmation`
- it better matches the transactional payment domain
- it avoids implying a legacy plan/product abstraction

### 10.2 Compatibility rule

Do not remove `purchase.product.confirmation` from scaffold/admin/tests until all three are completed:
1. code-search proves no runtime producer uses it
2. admin/db migration strategy is defined
3. UI/tests are updated to the canonical key

### 10.3 Migration/backfill expectation

If existing DB rows may already use `purchase.product.confirmation`, the implementation plan must include one of:
- data migration/backfill to the canonical key
- read-time compatibility alias during transition
- explicit operator-safe manual migration steps if automated migration is too risky

Unsafe approach:
- simply deleting the scaffold row or test references without reconciling persisted rows

### 10.4 Admin/scaffold cleanup

Only after reconciliation:
- remove the redundant scaffold entry
- update token registry/tests/admin expectations
- preserve any existing active template row by migrating it, not hiding it

## 11. Slice 4: Booking/Waitlist Email Payload Correctness

### 11.1 Scope boundary

Do not add a universal dispatcher hydrator.

The fix scope is:
- booking and waitlist transactional template families only

Unchanged unless specifically required by reconciliation work:
- payment payloads
- store payloads
- gift-card payloads
- auth payloads

### 11.2 Where shaping belongs

Payload shaping must remain in domain producers or family-specific enrichers under `src/lib/public-booking/*` or a narrow email-domain service, not in a global transport abstraction.

Allowed approaches:
- producer-side normalized payloads
- booking/waitlist-family enrichment before dispatch
- explicit required-token validation per template family

Disallowed approach:
- one dispatcher layer that attempts to hydrate every event type generically

### 11.3 Booking confirmation path rule

The plan must not create a third booking confirmation email path.

Implementation must:
- inspect `booking-confirmation-notification-service.ts`
- inspect `booking-confirmation-transition-service.ts`
- consolidate or reuse one canonical enqueue path
- keep reconciliation logic in the existing reconciliation path, not a second producer

### 11.4 Required-token validation

Define required-token validation boundaries by family:

Booking templates require, at minimum:
- class title
- start time label
- any customer-facing manage/context link required by the template

Waitlist templates require, at minimum:
- class title
- manage URL
- date/time label
- promotion-specific identifiers when relevant

Failure behavior:
- invalid or incomplete booking/waitlist payloads must fail the event clearly
- failures must dead-letter after retry policy
- no blank customer-facing token substitution is allowed for required fields

Non-goal:
- do not retroactively impose the same strict required-token semantics on payment/store/gift-card templates unless inventory proves the need

### 11.5 Missing token rendering

The current behavior silently blanks missing tokens. That is not acceptable for required booking/waitlist tokens.

New rule:
- optional tokens may still resolve empty if explicitly allowed by template contract
- required tokens must produce a structured failure reason

### 11.6 Waitlist enqueue failures

The plan must retain error visibility for waitlist enqueue failures and improve them if needed, but not swallow them as success.

## 12. Slice 5: Verified-State Auth/Header Consistency

### 12.1 `requireVerifiedUser`

Make customer auth fail closed on:
- missing DB user
- inactive or invalid activation state
- Prisma query failure
- schema/runtime DB lookup failure

Required behavior:
- clear stale-session path remains the recovery destination
- no raw DB error leaks to the user

### 12.2 Header affordance rule

Do not show customer “authenticated/dashboard” affordances from JWT presence alone.

Required outcome:
- derive display state from verified server/customer state
- when verified state cannot be proven, render signed-out/general affordances

The goal is consistency, not a full navbar redesign.

### 12.3 Shared contract

The plan must define one verified-customer state contract shared across:
- protected customer routes
- stale-session cleanup
- header account/dashboard affordances

## 13. Slice 6: Timezone Round-Trip Correctness

### 13.1 Admin edit form

The admin session edit form must:
- render `datetime-local` values in the configured site timezone
- parse submitted local timestamps back through site-timezone-to-UTC conversion
- persist UTC instants only

### 13.2 Helper rule

Do not rely on implicit default timezone for runtime session/email formatting when the result is user-facing and time-sensitive.

Require explicit site timezone in runtime-sensitive paths for:
- session edit round-trip
- reminder candidate scheduling if activated
- booking/waitlist email time labels where the current helper behavior is ambiguous

### 13.3 DST coverage

Add explicit DST-sensitive coverage around:
- editing a session near DST change boundaries
- displaying the same stored UTC instant back to admin correctly

### 13.4 Business-rule preservation

Any time-based change must preserve:
- server-authoritative UTC storage
- configured site-timezone display rules
- 24-hour cancellation policy based on scheduled start time

## 14. Slice 7: Optional Reminder Activation

This slice is gated and excluded by default.

Only proceed if Slice 1 records all of the following:
- active producer location
- cron enqueue timing
- timezone basis for “before class start”
- dedupe/idempotency key
- session edit reschedule rule
- cancellation/expired-session suppression rule

If activated, the reminder wording must be corrected to align with the 24-hour cancellation policy from `docs/10_01_business_rules.md`.

The current scaffold text `2x cancellation policy before start` is not canonically valid.

Approved enqueue architecture if activated:
- existing maintenance cron only
- existing email outbox only
- no new background subsystem

## 15. Acceptance Criteria

### AC-001 URL safety
- production runtime validation requires a canonical non-loopback `APP_URL`
- waitlist/manage links no longer fall back to localhost
- stale-session recovery never redirects to localhost in production

### AC-002 Template-key safety
- canonical payment template key is chosen
- redundant key is not removed until migration/backfill/compatibility is complete
- admin scaffold/tests reflect the reconciled final state

### AC-003 Booking/waitlist payload correctness
- booking/waitlist transactional templates receive stable required payload fields
- missing required fields fail clearly and dead-letter
- payment/store/gift-card emails are not regressed by a shared hydrator

### AC-004 Auth/header correctness
- verified-customer routes fail closed on DB lookup failures
- stale JWT presence alone does not cause customer dashboard affordances to appear

### AC-005 Timezone correctness
- admin session edit round-trips correctly in configured site timezone
- DST-focused tests pass

### AC-006 Reminder gating
- reminder behavior is either explicitly activated with full schedule contract or explicitly deferred
- no half-active reminder scaffolding ships as if it were runtime behavior

## 16. Test Plan

### Required targeted agent-run tests

Auth/session:
- `test/integration/route-protection.integration.test.ts`
- `test/integration/stale-session-route.integration.test.ts`
- `test/unit/require-auth.unit.test.ts`
- targeted navbar/header UI coverage if affected

Email/automations:
- `test/unit/email-automation-dispatcher-service.unit.test.ts`
- booking/waitlist enqueue payload coverage
- admin automations UI coverage
- payment-key reconciliation UI/test coverage

Timezone:
- `test/unit/public-catalogue-timezone.unit.test.ts`
- admin session edit coverage
- DST-sensitive integration/unit cases

Waitlist/booking:
- `test/integration/waitlist-service.integration.test.ts`
- booking confirmation reconciliation coverage if modified

### Required assertions

Add tests for:
- `APP_URL` validation helper
- waitlist manage-link generation
- missing required booking/waitlist tokens dead-letter instead of sending blank content
- payment/store payloads continue to deliver unchanged if untouched by this feature
- navbar/header verified-state mismatch behavior
- DST round-trip for admin session edit

### Operator-run validation

Only after targeted tests and build are stable:
- `npm test -- --run`
- `npm run test:e2e`
- `npm run build`
- manual UAT on `https://demo.bookmyclass.app`

Do not claim these as complete unless actually executed.

## 17. Minimum Safe Implementation Order

1. Slice 1 inventory and decision capture
2. Slice 2 shared `APP_URL` validation and waitlist/manage-link fix
3. Slice 3 payment/store template-key reconciliation and admin/test cleanup
4. Slice 4 booking/waitlist-only payload enrichment plus required-token failure semantics
5. Slice 5 verified-state auth/header consistency
6. Slice 6 admin session timezone round-trip and DST coverage
7. Slice 7 reminder activation only if explicitly approved after inventory

## 18. Best First Slice For Developer

Slice 1 plus the first safe part of Slice 2:
- inventory template keys, runtime producers, URL builders, and reminder scope
- add the canonical `APP_URL` helper
- fix waitlist localhost fallback
- add production env validation for `APP_URL` with explicit operator env audit note

This is the highest-safety first move because it closes an active user-facing defect without broad cross-domain dispatcher changes.

## 19. Safe To Start?

Yes.

It is safe to start implementation now because the plan has been corrected to:
- inventory before mutation
- gate reminders
- reconcile template keys before cleanup
- narrow email shaping to booking/waitlist scope
- preserve service boundaries

The first implementation slice must still be Slice 1 / Slice 2 as defined above.

## 20. Score

100/100 target readiness for implementation planning.

The plan is now ready because it:
- closes the auditor’s high-risk gaps
- removes unsafe assumptions
- defines exact sequencing
- preserves active-vs-modeled boundaries
- names migration, validation, and test obligations explicitly

## 21. Impact Summary

Impacted files
- `src/lib/auth/require-auth.ts`
- `src/app/auth/stale-session/route.ts`
- `src/components/Navbar.tsx`
- `src/lib/navigation/site-header-nav.ts`
- `src/lib/config/runtime-env-server.ts`
- `src/lib/public-booking/waitlist-notification-service.ts`
- `src/lib/public-booking/booking-confirmation-transition-service.ts`
- `src/lib/public-booking/booking-confirmation-notification-service.ts`
- `src/lib/email/email-automation-dispatcher-service.ts`
- `src/lib/email/email-automation-admin-service.ts`
- `src/lib/email/email-template-token-registry.ts`
- `src/app/admin/(private)/automations/page.tsx`
- `src/app/admin/(private)/sessions/[id]/edit/page.tsx`
- `src/lib/public-catalogue/timezone.ts`
- `src/lib/public-booking/format-session-date-time.ts`
- `src/app/api/cron/maintenance/route.ts` only if reminder activation is explicitly approved

Impacted services/modules
- customer auth/session guards
- stale-session cleanup
- header account navigation
- runtime env validation
- waitlist notification producers
- booking confirmation transition logic
- email automation scaffold/admin
- email dispatcher required-token behavior
- timezone conversion helpers
- admin session edit flow

Impacted tests
- `test/integration/route-protection.integration.test.ts`
- `test/integration/stale-session-route.integration.test.ts`
- `test/unit/require-auth.unit.test.ts`
- `test/unit/email-automation-dispatcher-service.unit.test.ts`
- `test/integration/waitlist-service.integration.test.ts`
- admin automations UI coverage
- timezone/admin-session edit coverage
- DST-sensitive timezone tests

Tests run: none; planning-only.
