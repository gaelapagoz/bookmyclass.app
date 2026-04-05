# Business Rules — Yoga Pilates Fitness Studio

## Purpose
This document defines the frozen product and operational rules for the booking and subscription platform.

---

## 1. Subscription Types

### 1.1 Collective Class Ticket Packs
The platform supports the following ticket packs for **collective classes**:
- Single ticket
- 3 tickets
- 5 tickets
- 8 tickets

These credits are valid for **all collective classes** and cannot be used for private classes.

### 1.2 Private Class Ticket Packs
The platform supports the following ticket packs for **private classes**:
- Single ticket
- 3 tickets
- 5 tickets
- 8 tickets

These credits are valid **only for private classes** and cannot be used for collective classes.

### 1.3 Monthly Unlimited
The platform supports a **Monthly Unlimited** subscription:
- Valid for unlimited **collective classes**
- Active only while the subscription is valid
- Renews automatically every month
- Can be cancelled at any time
- Cancellation takes effect at the end of the current billing period

---

## 2. Credit Validity

### 2.1 Ticket Pack Validity
All ticket packs:
- Are valid for **6 months from purchase date**
- Expire automatically after 6 months
- Cannot be used after expiration
- Cannot be transferred to another client
- Cannot be shared between clients
- Cannot be extended manually unless a future admin feature explicitly supports it

### 2.2 Monthly Unlimited Validity
Monthly Unlimited:
- Is valid only during the active billing period
- Ends at the end of the month or billing cycle, depending on subscription implementation
- Renews automatically unless cancelled
- Must be considered inactive if payment fails or the subscription is terminated

---

## 3. Booking Eligibility

A client may hold active access if at least one of the following is true:
- The client has at least one valid, unexpired ticket for the relevant class type
- The client has an active Monthly Unlimited subscription for collective classes

### 3.1 Collective Classes
A client may book a collective class if:
- They have a valid collective-class ticket available
- Or they have an active Monthly Unlimited subscription

### 3.2 Private Classes
A client may not self-book a private class.
Private classes must be booked manually by the studio or teacher.

---

## 4. Cancellation Window

A client can cancel a class booking up to **24 hours before the class start time**.

### 4.1 Valid Cancellation
If cancellation happens at least 24 hours before the class:
- The booking is cancelled
- The used credit is returned, if a credit was consumed
- The seat becomes available
- Waitlist promotion can be triggered

### 4.2 Late Cancellation
If cancellation happens less than 24 hours before the class:
- The booking may still be cancelled operationally
- The credit is considered used
- No credit is returned
- No refund is issued

---

## 5. No-Show Rules

A no-show means:
- The client had a valid booking
- The client did not attend
- The booking was not cancelled in time

No-show consequence:
- The ticket is considered used
- No credit is returned
- No refund is accepted

For Monthly Unlimited users:
- The class is considered consumed operationally
- Repeated no-show handling may be tracked in future versions, but no additional penalty is currently defined in this document

---

## 6. Waitlist Rules

When a class reaches full capacity:
- A waitlist is automatically opened

### 6.1 Waitlist Ordering
- Waitlist follows **FIFO** (First In, First Out)

### 6.2 Spot Allocation
If a spot becomes available:
- The first client in the waitlist gets the spot automatically
- The system creates the reservation for that client, provided the client still satisfies eligibility rules at the time of promotion

### 6.3 Notification
When a waitlisted client is promoted into the class:
- The client must be notified that the booking has been confirmed

---

## 7. Teacher Manual Booking Rules

Teachers or authorized studio staff can manually manage bookings for clients.

They can:
- Reserve a class
- Cancel a class

This applies to:
- Collective classes
- Private classes

### 7.1 Credit Requirement
Teachers can only reserve a class for a client if the client has:
- A valid available credit for that class type
- Or an active qualifying subscription for that class type

Teachers cannot bypass credit and subscription rules.

---

## 8. Loyalty Program

### 8.1 Earning
Clients earn loyalty points based on spending:
- **1 euro spent = 1 point earned**

### 8.2 Redemption
Points can be redeemed for discounts.

### 8.3 Configurability
Loyalty redemption rules must be configurable by the business, including:
- Point thresholds
- Discount amounts
- Discount types
- Whether redemption can be combined with other promotions

Exact thresholds are not frozen in this document and must be stored in configurable settings.

---

## 9. Private Class Handling

Private classes cannot be booked directly by clients through self-service flows.

Required flow:
- Client contacts the studio
- Studio or teacher creates the booking manually
- A valid private-class credit must exist before the booking is confirmed

---

## 10. Refund and Credit Return Behavior

### 10.1 Refunds
- No refunds are accepted under any circumstance

This applies to:
- Ticket packs
- Subscriptions
- Individual bookings
- Missed classes
- Late cancellations

### 10.2 Credit Returns
Credits are returned only when:
- The booking is cancelled at least 24 hours before class start

Credits are not returned when:
- Cancellation happens less than 24 hours before class start
- The client is a no-show
- The credit has expired

---

## 11. Active Access

A client is considered to have **active access** if the subscription or credit they need for a booking is currently valid.

In practice, active access means:
- The client has a valid ticket for the relevant class type
- Or the client has an active Monthly Unlimited subscription for collective classes

If neither condition is true, the client does not have active access.

---

## 12. Non-Transferability

Tickets and subscriptions:
- Belong only to the purchasing client
- Cannot be transferred
- Cannot be gifted after purchase unless a dedicated gifting feature is later implemented
- Cannot be pooled across multiple people

---

## 13. Time Reference Rules

All time-based rules must use the **scheduled class start time** as the authoritative reference.

Examples:
- Cancellation window = 24 hours before class start
- Expiration = 6 months after purchase timestamp
- Subscription validity = active billing period dates

Server time is authoritative.

---

## 14. Operational Notes for Engineering

These rules must be enforced:
- Server-side
- Consistently across customer, teacher, and admin actions
- Independently from frontend display logic

Frontend restrictions are helpful for UX, but they do not replace backend validation.
