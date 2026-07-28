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
- Merchandise
- Gift card

### Product type to entitlement behavior (active)
- `CLASS_PACK` creates a credit-pack entitlement rule with configurable credit quantity for collective classes.
- `PRIVATE_PACK` creates a credit-pack entitlement rule with configurable credit quantity for private classes.
- `DROP_IN_CLASS` creates a single-use collective-class entitlement rule.
- `UNLIMITED_MEMBERSHIP` creates unlimited collective access entitlement rules.

Removed legacy entitlement-backed types: `INTRO_OFFER`, `WORKSHOP_PASS`.
Gift cards are wallet-backed and must not create `ClientEntitlement` gift value.
Store customer flows are active in the current runtime and are not gated by Store rollout feature flags.
Merchandise is pickup-only in Store v1; customer-facing Store read models must carry `Pickup at studio.` wording.
Store catalog defaults are Product + Price records only: gift-card defaults are EUR 25, EUR 50, and EUR 100, plus at least three merchandise products.

### Admin catalog rules (active)
- Pack scope is derived from product type and is not selected manually:
  - `CLASS_PACK` => `COLLECTIVE_CLASSES`
  - `PRIVATE_PACK` => `PRIVATE_CLASSES`
- Billing type is derived from product type and is not selected manually:
  - `DROP_IN_CLASS`, `CLASS_PACK`, `PRIVATE_PACK` => one-time
  - `UNLIMITED_MEMBERSHIP` => recurring
- Billing interval applies only to `UNLIMITED_MEMBERSHIP`, with allowed values `MONTH` or `YEAR`.
- Store gift-card price exposure requires EUR, one-time pricing, active/non-archived state, amount > 0 and <= EUR 500, and a synced Stripe price.
- Store price edits preserve history; archived or inactive prices are filtered from checkout-ready Store read models rather than overwritten.

### Promotions
- Discount codes can be applied to orders.
- Promotions affect pricing but do not alter product structure.
- Promotions are covered through Coupons.

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
- Active booking statuses are `PENDING` and `CONFIRMED`.
- Booking statuses outside active uniqueness are `CANCELLED`, `EXPIRED`, `COMPLETED`, and `NO_SHOW`.
- `BookingStatus.EXPIRED` already exists in the schema and is the canonical state for expired drafts.
- `COMPLETED` and `NO_SHOW` remain historical attendance-adjacent booking states and are not part of the active partial index.
- Cancelled and expired bookings remain rebookable historical records.
- Rebooking creates a new booking row.
- Expired `PENDING` drafts must not block capacity or active uniqueness.
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
- Waitlist join/cancel/auto-promotion is active.
- Before modifying capacity or booking logic, verify and preserve current waitlist behavior.

### Active booking uniqueness
- Exact migration-owned index:

```sql
CREATE UNIQUE INDEX "Booking_active_client_session_unique"
ON "Booking" ("clientId", "studioSessionId")
WHERE "status" IN ('PENDING', 'CONFIRMED');
```

- Required production pre-deploy audit:

```sql
SELECT "clientId", "studioSessionId", COUNT(*)
FROM "Booking"
WHERE "status" IN ('PENDING', 'CONFIRMED')
GROUP BY "clientId", "studioSessionId"
HAVING COUNT(*) > 1;
```

- Expected result is 0 rows.
- If non-zero, stop deploy and produce a manual cleanup plan.
- The active booking uniqueness index is migration-owned because Prisma cannot fully represent the PostgreSQL partial unique index.
- Do not reintroduce broad `@@unique([clientId, studioSessionId])`.
- Rollback may recreate the original broad unique constraint only if no multiple historical rows exist.
- Never delete booking history automatically.
- Expired-draft behavior must use `BookingStatus.EXPIRED`; `COMPLETED` and `NO_SHOW` must not be included in active uniqueness.

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

### Admin no-credit booking override
- `ADMIN` and `MASTER_ADMIN` may manually add a client without valid credit/subscription only through explicit audited override.
- `TEACHER` cannot use this override.
- Override requires a trimmed reason of at least 10 characters.
- Override counts toward capacity.
- Override is visibly labelled in admin session reporting as `Manual override — no credit used`.
- Override does not consume credit, create entitlement ownership, payment, or revenue.
- Override reason is admin-only and preserved as audit evidence.

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

### Timezone rules
- Timezone belongs to dedicated site settings/config.
- `StudioSession` times remain UTC instants.
- Public availability date keys, kiosk labels, and check-in enforcement must use the configured timezone consistently.

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

### Gift-card wallet foundation
- Gift-card value is tracked only through `GiftCardWallet`, `GiftCardLedgerEntry`, and `GiftCardRedemption`.
- Wallet settled balance is `ACTIVATION - CAPTURE`; available balance subtracts active `RESERVED` redemptions.
- Gift-card mutations must be idempotent with persisted payload hashes.
- Wallet mutations must lock the wallet row and write ledger entries in the same transaction.
- Only users with role `CLIENT` may receive gift-card wallets.
- Wallet cap pre-check includes current wallet balance, pending unpaid gift-card orders, and the new gift-card order value.
- Gift-card purchase value is capped at EUR 500 per order; merchandise quantity is capped at 10 per product/order.
- Expired `RESERVED` gift-card redemptions are released by maintenance in batches of at most 100.
- Maintenance release uses the wallet lock and must not create duplicate `RELEASE` ledger entries.
- Admin gift-card visibility is read-only for wallet balances, ledger entries, redemptions, and reconciliation cases.
- `ADMIN` may add non-financial reconciliation notes only; notes do not adjust wallet, ledger, payment, or order state.
- `MASTER_ADMIN` may resolve `MANUAL_REVIEW` cases only after service-level consistency verification passes.
- Resolved reconciliation cases are hidden by default and remain filterable for operational review.

### Loyalty ledger foundation (spend earning active)
- Loyalty points must use a separate immutable ledger from gift-card and credit ledgers.
- Reward redemption must convert points into loyalty credit through a separate audited loyalty-credit ledger.
- Combined wallet presentation is read-model only and must not merge loyalty mutations into gift-card services.
- Loyalty earn, redeem, reverse, expire, and manual-grant events must use persisted idempotency keys derived from the commercial or maintenance event.
- Loyalty balances must be derived from ledger history; no hidden mutable balance fields should become the source of truth.
- Loyalty expiration reminders must enqueue replay-safe outbox events through `GET /api/cron/maintenance`, with idempotency derived from source entry plus effective date.
- Expired loyalty-credit reservations may be released by maintenance only when no Stripe checkout session is already attached to the order.

### Loyalty earning and reversal rules
- Loyalty awards occur only after successful settlement in existing checkout finalization or webhook-safe flows.
- Duplicate webhook delivery, reconciliation replay, and manual replay must not create duplicate awards.
- Reversal writes must link back to the original earning event and must not reverse the linked event below zero.
- Partial financial reversals use proportional reversal based on reversed eligible settled amount, rounded down to whole points.
- Failed, expired, and unpaid checkout paths create no loyalty award.

### Loyalty admin permission boundaries
- `ADMIN` and `MASTER_ADMIN` may grant positive whole-number manual points with required reason and audit metadata.
- Authorized manual loyalty grants are not capped by a business-configured maximum; the administrator, role, reason, amount, timestamp, and immutable ledger entry remain auditable.
- `ADMIN` and `MASTER_ADMIN` own loyalty program configuration and reward definition changes.
- Negative loyalty adjustments are not part of the first admin UX unless a separate guarded reconciliation path is explicitly approved.
- Client-facing loyalty history and wallet views are read models only and must enforce verified active client ownership server-side.

### Loyalty redemption and checkout contract freeze
- Cart checkout accepts a loyalty-credit contract field for active one-time redemption flows.
- Recurring carts must reject loyalty credit before reservation, capture, or release logic is reached.
- Loyalty credit reserve/capture/release behavior must be owned by loyalty services and must not reuse gift-card redemptions or ledger mutations.
- Success-summary read models must derive coupon, loyalty-credit, gift-card, and Stripe/card contribution lines from server-side order/payment records only.
- Zero-payment loyalty paths are allowed only after reserve/capture/release safety and audit coverage are implemented.

### Loyalty and gift-card separation
- Loyalty credit must never mutate `GiftCardWallet`, `GiftCardLedgerEntry`, or `GiftCardRedemption`.
- Gift-card reconciliation tools must not be reused to mutate loyalty balances.
- Shared wallet UI may present both balances, but domain invariants stay isolated by service boundary.

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
- Explicit audited admin overrides are the only exception and must not create entitlement ownership.

### Types of entitlements
- Single-use (drop-in)
- Credit-based (class packs)
- Unlimited access (subscriptions)

### Rules
- Entitlement consumption is explicitly recorded.
- Refund/restoration is explicitly recorded.
- No hidden or implicit entitlement logic.

---

## 11. Credits

### Credits
- Credits are tracked using an immutable ledger.
- Ledger entries include:
  - grant
  - consume
  - refund
  - expire
  - adjustment
- Credit balance is derived from ledger entries.

### Admin actions
- Manual adjustments are allowed.
- All adjustments must be auditable.

---

## 12. Booking Drafts

- Booking drafts represent temporary holds on session capacity during the booking process.
- Drafts have PENDING status and are created before payment confirmation.
- Drafts expire automatically after 15 minutes if not confirmed.
- Expired drafts must move to `BookingStatus.EXPIRED`.
- Expired drafts do not count towards session capacity.
- Lifecycle target: Draft -> Payment -> Confirmed OR Expired.
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
- Admin no-credit booking overrides with admin-only metadata.

### Override audit metadata
- Override reason is admin-only.
- Override reason must not appear in client views.
- Override reason must not be sent by email.
- Override reason must be sanitized from public logs and Sentry payloads.
- Override metadata is retained as audit evidence.
- Do not delete override metadata if any override bookings exist.

---

## 15. Media Persistence

- Shared media helper must exist before new upload paths.
- No direct upload fallback is allowed.
- Upload validation must cover size, MIME, extension, magic bytes, safe filename, path normalization, path containment, and allowed folders.
- Write file first, then persist DB path.
- DB path must not persist if file write fails.
- If DB write fails after file write, clean up the orphan file where feasible.
- Missing local image files must render fallback UI.
- Backups and restores must include uploaded media folders.

---

## 16. General Principles

- Prefer explicit data over implicit logic.
- Preserve historical data (no destructive updates).
- Use append-only ledgers for financial-like data.
- Avoid hard deletes for business-critical entities.
- Design for clarity first, optimization later.
