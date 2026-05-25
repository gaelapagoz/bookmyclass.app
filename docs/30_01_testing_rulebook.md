# Testing Rulebook

This rulebook keeps testing lightweight and consistent for this repository.

## Scope
Applies to all feature, bugfix, and refactor work touching:
- auth and route protection
- booking and entitlements
- checkout/payments/webhooks
- learning routes/data flow
- API routes and domain services
- page-level branching behavior

## Release-Critical Flows
These areas are release-critical and require explicit coverage whenever touched:
- auth (sign-in, verification, protection gates)
- booking (draft, eligibility, confirm/cancel paths)
- checkout (session creation and success reconciliation)
- webhook (Stripe signature, idempotent processing, failure handling)
- gift-card wallet foundation (ledger invariants, idempotency, concurrency)
- store catalog readiness (EUR filtering, Stripe sync exposure, pickup wording, quantity caps)
- cancellation (before cutoff vs late cancellation behavior)
- admin mutations (authorization + validation + persistence behavior)

## When Tests Are Required
Add or update tests when a change modifies:
- business/domain logic in services or server actions
- API route request/response behavior
- auth gating, role checks, or protected flows
- payment, checkout, webhook, or idempotency logic
- wallet or ledger mutation logic
- page branching states (`success`, `empty`, `error`, `notFound`, `unauthorized`)
- route params/query handling (sorting, filtering, pagination)

Tests may be skipped only for:
- pure copy/content text changes
- styling-only changes with no behavior impact
- internal refactors that are fully covered by existing tests and do not change behavior

## When Test Updates Are Required
If an existing feature already has tests, update those tests when you change:
- payload shape, status code, or error code
- ordering, filtering, pagination, or route key behavior
- fallback behavior (null handling, error handling, not-found handling)
- integration boundaries (service -> API, API -> page)

Do not leave outdated tests passing by removing assertions that verify behavior.

## Minimum Coverage Rules

### Auth Changes (minimum)
- authenticated path succeeds
- unauthenticated path is blocked/gated correctly
- wrong user/role cannot access protected mutation or flow
- expected status/response shape is asserted (`401/403/redirect/modal gate` as applicable)

### API + Business Logic Changes (minimum)
- happy path
- invalid input/validation failure
- not-found or not-allowed case
- one idempotency or replay-safe case for payment/booking/webhook operations
- concurrency coverage for financial ledger reservations when balance can be overspent
- assert status code and stable response contract (not only body fragments)

### UI/Page Branching States (minimum)
For pages with branching render logic, cover:
- data available state
- empty state
- error/fallback state
- invalid route/param -> `notFound` (when applicable)

Prefer deterministic page/component tests with mocked data helpers.

## Test Type Selection (practical default)
- `unit`: pure helpers/mappers/parsers
- `integration`: API routes + services + DB interaction
- `ui`: component/page branching and rendering behavior

Use the smallest test type that proves behavior. Add E2E only for cross-flow smoke scenarios.

## Execution Safety Contract
- Unit/UI test files may run in parallel.
- DB-backed integration tests must run serially by default because they use shared destructive resets (`resetDb` + truncate).
- DB-mutating E2E runs must use one Playwright worker by default unless each worker has an isolated database.
- Full local `npm test` should execute `test:unit` first, then `test:integration`.
- Full-suite runs are operator-approved only when runtime cost is acceptable.

## Definition of Done
A change is done only when:
1. Required tests were added or updated.
2. New behavior is asserted (not implied).
3. Existing impacted tests still pass.
4. Commands to run relevant tests are documented in the PR/task summary.
5. No critical path (auth, booking, checkout, webhook, cancellation, admin mutations) is left without coverage for changed behavior.
6. Handoff summary states exactly what tests were run.
7. If any high-risk area was intentionally skipped, handoff summary states the skipped area and why.
