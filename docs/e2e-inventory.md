# E2E Inventory (Beta-Critical)

This inventory defines the production-relevant Playwright scope for the current beta.

## Scope Rules

- Include only active runtime flows confirmed in `docs/system-baseline.md`.
- Exclude modeled-but-inactive flows for this pass.
- Waitlist and no-show are explicitly out of scope.

## Smoke

1. Public homepage loads.
2. Admin sign-in works.
3. Client sign-in works.

## Critical

### Client

1. Sign up -> verify email -> first login.
2. Buy subscription product via Stripe checkout handoff and completion.
3. Book class using existing entitlement.
4. Book class via Stripe checkout handoff and completion.
5. Dashboard shows booking and membership state.
6. Cancel booking when cancellation window allows it.

### Admin

1. Create teacher user.
2. Create booking service.
3. Update booking service.
4. Create calendar session.
5. Update calendar session.

## Extended (active + stable only)

1. Online learning navigation from listing to course detail.
2. Marketing campaign active flow (step flow to sent confirmation).
3. Inbox review flow (update message status).

## Out Of Scope (This Pass)

1. Waitlist runtime behavior.
2. No-show runtime behavior.
3. Any cleanup-only destructive admin feature.
