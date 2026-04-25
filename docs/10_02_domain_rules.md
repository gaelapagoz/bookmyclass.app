# Domain Rules

This document defines the core business rules for the studio management platform.
These rules guide the Prisma schema design and must remain consistent across the system.

---

## 1. Identity and Roles

- Each user has exactly one system role.
- Supported roles:
  - MASTER_ADMIN
  - ADMIN
  - TEACHER
  - CLIENT
- Roles are mutually exclusive.
- A user cannot hold more than one role.
- Access control is based strictly on the assigned role.

### Account lifecycle
- Users are never hard-deleted in normal operations.
- Users may be marked as inactive after 30 days without login.
- Inactive users can still log in at any time.
- Upon login, the inactive flag is removed.
- Historical records (bookings, orders, payments, etc.) always remain linked to the user.

---

## 2. Profiles

- A client has one ClientProfile.
- A teacher has one TeacherProfile.
- Profiles are role-specific and cannot overlap.
- Admin users do not require a separate profile model in v1.

---

## 3. Studio Offerings

- A Product defines what is being sold.
- A Price defines the commercial version of a product.
- A Product may have multiple Prices over time.
- Prices must preserve history (no destructive overwrite).
- Entitlement rules define what access is granted after purchase.

### Product types
- Drop-in class
- Class pack
- Subscription / membership
- Private session
- Workshop / special event
- Gift cards (planned for later implementation)

### Product type to entitlement behavior (active)
- `CLASS_PACK` creates a credit-pack entitlement rule with configurable credit quantity for collective classes.
- `PRIVATE_PACK` creates a credit-pack entitlement rule with configurable credit quantity for private classes.
- `DROP_IN_CLASS` creates a single-use collective-class entitlement rule.
- `UNLIMITED_MEMBERSHIP` creates unlimited collective access entitlement rules.

Removed types: `INTRO_OFFER`, `WORKSHOP_PASS`, `GIFT_CARD` (migrated to `DROP_IN_CLASS` / `CLASS_PACK` respectively).

### Admin catalog rules (active)
- Pack scope is derived from product type and is not selected manually:
  - `CLASS_PACK` => `COLLECTIVE_CLASSES`
  - `PRIVATE_PACK` => `PRIVATE_CLASSES`
- Billing type is derived from product type and is not selected manually:
  - `DROP_IN_CLASS`, `CLASS_PACK`, `PRIVATE_PACK` => one-time
  - `UNLIMITED_MEMBERSHIP` => recurring
- Billing interval applies only to `UNLIMITED_MEMBERSHIP`, with allowed values `MONTH` or `YEAR`.

### Promotions
- Discount codes can be applied to orders.
- Promotions affect pricing but do not alter product structure.

---

## 4. Classes and Scheduling

- A ClassTemplate defines the reusable structure of a class.
- A RecurringRule defines how sessions are generated.
- A Session is a concrete scheduled occurrence.
- Bookings always target Sessions (never templates or recurrence rules).

### Teacher assignment
- A Session has exactly one assigned teacher.
- A ClassTemplate may define a default teacher.
- A Session may override the template teacher.

### Capacity
- Every Session has a maximum capacity.
- Capacity is defined when creating the class (via template or session).

---

## 5. Bookings and Waitlist

- A client may have only one active booking per session.
- When a session is full:
  - Clients may optionally join a waitlist.
- Waitlist is ordered by creation time (FIFO).

### Waitlist promotion
- When a confirmed booking is cancelled:
  - The first client on the waitlist is automatically promoted.
  - The promoted client:
    - receives a notification
    - is automatically booked into the session
    - is charged (credit or entitlement consumed)

- Waitlist join does NOT consume credits.

> Note: automatic promotion may be implemented later, but must be supported by the schema.

---

## 6. Booking Policy

- Only one active booking per client per session is allowed.
- Clients may cancel bookings until a configurable cutoff time.
- The cutoff is globally configurable for the system.

### Cancellation behavior
- Early cancellation (before cutoff):
  - Credits or entitlements are returned/restored.
- Late cancellation (after cutoff):
  - No credit or entitlement is returned.
- Monetary/payment refunds are not accepted for purchased plans or bookings.
- Admins can override cancellation outcomes.

---

## 7. Attendance

- Booking tracks reservation lifecycle.
- Attendance is tracked separately.

### Approach
- BookingStatus handles:
  - booking state (confirmed, cancelled, etc.)
- Attendance (or AttendanceStatus) handles:
  - check-in
  - attended
  - no-show

### Attendance state machine (active)
- Allowed transitions:
  - `null -> CHECKED_IN`
  - `null -> ATTENDED`
  - `null -> NO_SHOW`
  - `CHECKED_IN -> ATTENDED`
  - `CHECKED_IN -> NO_SHOW`
  - `CHECKED_IN -> null` (staff undo only)
- Finalized states:
  - `ATTENDED` and `NO_SHOW` are terminal in normal operations.

### Kiosk and dashboard check-in rules (active)
- Self check-in can originate from:
  - kiosk (`AttendanceSource.KIOSK`)
  - dashboard (`AttendanceSource.DASHBOARD`)
- Self check-in is only allowed for confirmed bookings in the configured check-in window.
- Private classes are excluded from self check-in routes.
- Staff can finalize attendance privately from teacher/admin session detail pages.

---

## 8. Commerce

- An Order represents a commercial transaction.
- An Order can contain one or more OrderItems.
- An Order may exist before payment is completed.

### Payments
- A Payment belongs to an Order.
- Payments track financial transactions independently.
- Payment states include success, failure, and refund.
- Payment history must be preserved.

### Entitlements
- Entitlements are only activated after successful payment.

---

## 9. Subscriptions

- A client may have at most one active subscription at a time.
- A subscription may:
  - grant unlimited access to eligible sessions, OR
  - grant recurring credits

### Lifecycle
- Subscriptions are time-based.
- Cancellation takes effect at the end of the billing period.
- Subscription history must be preserved.

---

## 10. Entitlements

- Every booking must be backed by a valid entitlement.

### Types of entitlements
- Single-use (drop-in)
- Credit-based (class packs)
- Unlimited access (subscriptions)

### Rules
- Entitlement consumption is explicitly recorded.
- Refund/restoration is explicitly recorded.
- No hidden or implicit entitlement logic.

---

## 11. Credits and Loyalty

### Credits
- Credits are tracked using an immutable ledger.
- Ledger entries include:
  - grant
  - consume
  - refund
  - expire
  - adjustment
- Credit balance is derived from ledger entries.

### Loyalty
- Loyalty points are tracked using an immutable ledger.
- Same principles as credits apply.

### Admin actions
- Manual adjustments are allowed.
- All adjustments must be auditable.

---

## 12. Booking Drafts

- Booking drafts represent temporary holds on session capacity during the booking process.
- Drafts have PENDING status and are created before payment confirmation.
- Drafts expire automatically after 15 minutes if not confirmed.
- Expired drafts are cancelled and do not count towards session capacity.
- Lifecycle: Draft → Payment → Confirmed OR Expired → Cancelled.
- If payment arrives after expiration, the booking is not confirmed, and payment must be rejected and escalated for operational handling.

---

## 12. Pricing

- Prices must not be overwritten destructively.
- New prices create new records or deactivate old ones.
- Historical orders retain original purchase amounts.

---

## 13. Admin Notes and Contact Messages

### Admin Notes
- Internal use only.
- Can be attached to:
  - clients
  - orders
  - general context

### Contact Messages
- Stored as immutable inbound records.
- Have a status (e.g., OPEN, RESOLVED).

---

## 14. Audit Log

Audit logs must record:

- Actor (user)
- Action type
- Entity type
- Entity ID
- Timestamp
- Metadata (JSON)

### Events to log (v1)
- Login events
- Role/admin actions
- Booking changes
- Order and payment changes
- Subscription changes
- Manual credit adjustments

---

## 15. General Principles

- Prefer explicit data over implicit logic.
- Preserve historical data (no destructive updates).
- Use append-only ledgers for financial-like data.
- Avoid hard deletes for business-critical entities.
- Design for clarity first, optimization later.
