# Codex Rulebook — On The Mat Studio

## Purpose
This document defines strict implementation rules for Codex to follow when generating or modifying code.

---

## Golden Principles

### Server is Source of Truth
All business rules must be enforced on the backend.

### No Business Logic in UI
Frontend is display-only. No validation logic beyond UX.

### One Rule = One Place
Each rule must live in a single service.

### Validate Before Mutate
Always:
1. Validate
2. Apply
3. Persist

---

## Credits & Subscriptions

- Booking requires:
  - Valid credit OR active subscription
- Credit must:
  - Not be expired
  - Match class type

Use:
CreditService.assertCanConsume(userId, classType)

---

## Expiration

- Credits expire after 6 months
- Never usable after expiration

Always enforce in DB queries:
WHERE expires_at > NOW()

---

## Cancellation

- Allowed ≥ 24h before class
- If valid → credit returned
- If late → credit lost

Use:
BookingService.cancelBooking()

---

## No-Show

- No-show = credit consumed
- No refund

Use:
BookingService.markNoShow()

---

## Waitlist

- FIFO queue
- Auto-book when spot opens
- Notify user

Use:
WaitlistService.promoteNextUser()

---

## Teacher Booking

- Same rules as users
- Cannot bypass credit validation

Use:
BookingService.createBooking()

---

## Private Classes

- Cannot be booked by users
- Only manual booking allowed

---

## Loyalty

- 1€ = 1 point
- Redemption is configurable

Use:
LoyaltyService.earn()
LoyaltyService.redeem()

---

## Refunds

- No refunds allowed

---

## Active Access

User is active if:
- Has valid credit
OR
- Has active subscription

Use:
AccessService.hasActiveAccess()

---

## Data Rules

### Transactions Required For:
- Booking
- Cancellation
- Waitlist promotion

### Idempotency
Prevent:
- Double booking
- Double credit usage

### Time Handling
- Always use server time (UTC)

---

## API Rules

Use explicit endpoints:
- POST /bookings
- POST /bookings/{id}/cancel

---

## Code Quality

- Clear naming
- Small functions
- No magic values
- Log key actions

---

## Testing

Must test:
- Expiration
- Cancellation edge cases
- No-show
- Waitlist

---

## Forbidden

- Business logic in frontend
- Duplicated rules
- Manual DB edits bypassing services
- Teacher bypass logic

---

## Codex Prompting Rules

Always include:
- Business context
- Edge cases
- Constraints

Example:

Create a BookingService that:
- Validates credit
- Enforces 24h cancellation
- Prevents private booking by users
- Uses transactions

---

## Definition of Done

A feature is complete only if:
- Rules enforced server-side
- No duplication
- Tests exist
- Edge cases covered