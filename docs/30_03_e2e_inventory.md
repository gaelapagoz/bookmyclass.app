# E2E Inventory (Production-Critical)

This inventory defines the production-launch Playwright scope for release-blocking and safety-critical flows.

## Scope Rules

- Include only active runtime flows confirmed in `docs/00_01_system_baseline.md`.
- Exclude modeled-but-inactive flows for this pass.
- No-show is explicitly out of scope for this pass.

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
7. Dashboard self check-in within check-in window.
8. Client blocked from staff-only kiosk routes.
9. Full class waitlist join from public booking UI and waitlist cancellation from dashboard.

### Admin

1. Create teacher user.
2. Create booking service.
3. Update booking service.
4. Create calendar session.
5. Update calendar session.
6. Kiosk access for staff check-in oversight.
7. Attendance finalization from session detail.

### Teacher

1. Kiosk session selection and check-in for collective classes.
2. Kiosk exit requires password re-entry.
3. Kiosk check-in blocked outside window.
4. Private class sessions excluded from kiosk self check-in flow.

## Extended (active + stable only)

1. Online learning navigation from listing to course detail.
2. Marketing campaign active flow (step flow to sent confirmation).
3. Inbox review flow (update message status).

## Out Of Scope (This Pass)

1. No-show runtime behavior.
2. Any cleanup-only destructive admin feature.
