# Manual Test Campaign - UAT and Release Validation

## Purpose
Define the operator-led manual UAT campaign for active, production-critical and major flows across Client, Admin, and Teacher/kiosk usage in `studio.saas.platform`.

## Scope
This campaign validates only active runtime capabilities confirmed by baseline docs and current UAT release validation scope.

Included personas:
- Client
- Admin
- Teacher / kiosk staff

Explicit exclusions:
- No-show operational flow

## Conflict Resolution
A capability conflict previously existed in source documents for waitlist status.

Resolution used for this campaign:
- Waitlist join/cancel/auto-promotion is treated as active and included in this campaign.
- No-show remains excluded.

## Entry Criteria
- UAT environment is reachable at `https://uat.bookmyclass.app`.
- UAT tag deployment is complete and smoke endpoints respond.
- Required seeded accounts and data are available (client/admin/teacher).
- Stripe test mode credentials and test cards are available for operator checkout checks.
- No critical infra incident is active (DB, app runtime, webhook endpoint).

## Exit Criteria
- All release-blocking tests pass.
- No open S1 or S2 defects.
- Any S3/S4 defects are documented with owner and target fix decision.
- Evidence is attached for each release-blocking case.
- Operator signoff checklist (`docs/30_09_operator_execution_checklist.md`) is completed.

## Severity Model
- `S1`: System unavailable, data-loss risk, or security/access control failure in critical path. Release stop.
- `S2`: Critical business flow broken (auth, booking, checkout, cancellation policy, admin control). Release stop.
- `S3`: Major non-blocking functional issue with workaround. Release decision required.
- `S4`: Minor UX/content/polish issue. Track post-release unless clustered.

## Test Data Prerequisites
- `client_new`: no bookings, no entitlement.
- `client_verified`: verified and able to sign in.
- `client_with_collective_credit`: has valid collective entitlement.
- `client_with_active_membership`: has active subscription contract.
- `client_with_booking_early_cancel`: confirmed collective booking >24h before session.
- `client_with_booking_late_cancel`: confirmed collective booking <24h before session.
- `client_waitlist_candidate`: verified client without an active booking for the targeted full collective session.
- `client_waitlist_ineligible`: waitlisted client intentionally lacking valid entitlement for promotion checks.
- `client_waitlist_monthly_unlimited`: waitlisted client with active Monthly Unlimited for collective classes.
- `admin_operator`: role `ADMIN` or `MASTER_ADMIN`.
- `teacher_operator`: role `TEACHER` with kiosk flow access.
- Active collective session in check-in window and one outside check-in window.
- Active private session (for exclusion check in self-check-in/kiosk path).
- At least one active Product + Price for `/subscription` checkout.
- At least one full collective session with waitlist capacity available.
- At least one full collective session with waitlist already full.

## Recommended Execution Order
1. UAT smoke
2. Client auth
3. Client booking
4. Client waitlist
5. Client subscription/membership
6. Client dashboard/profile/security
7. Admin auth/access
8. Admin catalog/session/user operations
9. Teacher/kiosk/attendance
10. Learning
11. Inbox/contact
12. Marketing
13. Agenda/public document
14. Operational confidence checks

## Release-Blocking Subset
`SMK-001`, `SMK-002`, `AUT-001`, `AUT-002`, `AUT-003`, `BKG-002`, `BKG-003`, `BKG-004`, `BKG-005`, `BKG-006`, `BKG-007`, `WTL-001`, `WTL-002`, `WTL-003`, `SUB-001`, `SUB-002`, `DBO-001`, `ADM-001`, `ADM-002`, `AOP-001`, `AOP-002`, `TCH-001`, `TCH-002`, `TCH-003`, `LRN-001`, `INB-001`, `AGD-001`, `OPC-001`

## Known Baseline Risks (Must Be Watched During UAT)
- Teacher workflow enforcement is a known risk area; execute teacher/kiosk tests with strict evidence capture and do not over-assume role gating behavior.
- Server-side rules are authoritative; UI behavior that appears valid must still match backend enforcement outcomes.
- Product + Price is the catalog source of truth; any mismatch between catalog display and checkout behavior is an S2.

## Manual Campaign

### UAT Smoke

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| SMK-001 | Admin | Critical | Yes | UAT core endpoints respond | UAT deployed | Call `/api/health`, `/`, `/sign-in`, `/book-a-class`, `/subscription`, `/api/categories` | All endpoints return expected success (`200`; health ready) and pages render usable content |
| SMK-002 | Admin | Critical | Yes | UAT smoke command pass | UAT deployed and operator shell access | Run `npm run test:uat:smoke` against `https://uat.bookmyclass.app` | Smoke command exits successfully with no failed check |

### Client Auth

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| AUT-001 | Client | Critical | Yes | Sign up, verify email, first sign in | New email inbox available | Sign up; open verification link/token; sign in | Account is verified and first login succeeds |
| AUT-002 | Client | Critical | Yes | Verified credentials sign in | `client_verified` exists | Sign in at `/sign-in` with valid credentials | User reaches dashboard and session is active |
| AUT-003 | Client | Critical | Yes | Forgot/reset password flow | Verified user and inbox access | Request reset; open reset link; set new password; sign in with new password | Reset succeeds, new password works, old password no longer valid |
| AUT-004 | Client | Major | No | Verification resend behavior | Unverified signup exists | Trigger resend from verify/sign-in path; use latest token | Latest token verifies account successfully without duplicate-account issues |

### Client Booking

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| BKG-001 | Client | Major | No | Public class discovery and slot visibility | Active collective classes exist | Open `/book-a-class`; select service; inspect available slots | Categories/services/slots load correctly with no broken states |
| BKG-002 | Client | Critical | Yes | Booking draft and payment options load | Signed-in client and valid collective slot | Create booking draft; open payment options for booking | Draft is created and valid payment options are returned |
| BKG-003 | Client | Critical | Yes | Booking using existing entitlement | `client_with_collective_credit` | Draft booking; apply entitlement/plan option; confirm | Booking confirms without checkout redirect, entitlement is consumed correctly |
| BKG-004 | Client | Critical | Yes | Booking via Stripe checkout and reconciliation | `client_verified` without matching credit + Stripe test data | Draft booking; choose checkout path; complete Stripe test checkout; return to success page | Booking/payment finalize and success page reconciliation reflects confirmed booking |
| BKG-005 | Client | Critical | Yes | Private class self-booking is blocked | Signed-in client and private class offering exists | Attempt private booking through self-service flow | Server-side enforcement blocks self-booking for private classes |
| BKG-006 | Client | Critical | Yes | Early cancellation restores credit | `client_with_booking_early_cancel` (>24h) | Cancel booking from dashboard | Booking cancels and credit is restored when applicable |
| BKG-007 | Client | Critical | Yes | Late cancellation does not restore credit | `client_with_booking_late_cancel` (<24h) | Cancel booking from dashboard | Booking cancellation does not restore credit and policy message is consistent |

### Client Waitlist

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| WTL-001 | Client | Critical | Yes | Join waitlist from full collective class | `client_waitlist_candidate`; full collective session with waitlist space | Open full collective slot in public booking UI; click `Join Waitlist`; open dashboard bookings | Waitlist join succeeds, booking CTA is replaced correctly for full class, dashboard shows active waitlist entry, no waitlist position shown |
| WTL-002 | Client | Critical | Yes | Cancel waitlist entry from dashboard | Active waitlist entry exists for client | Open dashboard bookings; cancel waitlist entry | Waitlist entry is cancelled and no longer displayed as active; user receives success feedback |
| WTL-003 | Client/System | Critical | Yes | Auto-promotion after confirmed booking cancellation | Full collective session; at least one eligible waitlisted client; one confirmed booking to cancel | Cancel a confirmed booking that frees one seat | First eligible waitlisted client is promoted automatically, confirmed booking is created, entitlement/subscription handling is correct, promotion email is sent |
| WTL-004 | Client/System | Major | No | Ineligible waitlisted client skipped and removed | First waitlisted client ineligible; second waitlisted client eligible | Trigger seat release via cancellation | Ineligible entry is removed/skipped, next eligible client is promoted, audit trail reflects skip + promotion |
| WTL-005 | Client/System | Major | No | Monthly Unlimited promotion path | Waitlisted client with active Monthly Unlimited | Trigger seat release via cancellation | Client is promoted without incorrect credit consumption and receives promotion notification |
| WTL-006 | Client | Major | No | Waitlist unavailable/full UI state messaging | Full collective slot with no remaining waitlist capacity, plus private class slot | Open slot list and inspect CTA/state | UI clearly shows full/waitlist-unavailable states, private class does not show waitlist join, no waitlist position exposed |

### Client Subscription/Membership

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| SUB-001 | Client | Critical | Yes | Subscription catalog uses Product + Price | Active checkout-enabled products/prices | Open `/subscription`; inspect available offerings | Displayed offerings are active Product + Price items (no plan-model drift) |
| SUB-002 | Client | Critical | Yes | Subscription checkout success | Signed-in client and Stripe test data | Start checkout from `/subscription`; complete Stripe test checkout; open success page | Successful completion creates owned membership state visible in dashboard/membership |
| SUB-003 | Client | Major | No | Billing portal access | Client has Stripe customer/subscription | Trigger billing portal action | Portal session opens successfully for eligible user |

### Client Dashboard/Profile/Security

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| DBO-001 | Client | Critical | Yes | Dashboard bookings and membership consistency | Client with known bookings/entitlements | Open dashboard bookings + membership sections | Booking and membership data are consistent with latest completed flows |
| DBO-002 | Client | Major | No | Profile update | Signed-in client | Update profile fields and save | Changes persist and display on reload |
| DBO-003 | Client | Major | No | Email change verification flow | Signed-in client with password known | Request email change; verify new email token; re-authenticate if prompted | Email change requires verification and final account email updates correctly |

### Admin Auth/Access

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| ADM-001 | Admin | Critical | Yes | Admin sign-in to private area | `admin_operator` exists | Sign in at `/admin`; open private dashboard page | Admin login succeeds and private area is accessible |
| ADM-002 | Admin | Critical | Yes | Admin area blocked for non-admin | Valid client account | Attempt access to `/admin/(private)` routes as client | Access is denied/redirected by server-side admin guard |

### Admin Catalog/Session/User Operations

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| AOP-001 | Admin | Critical | Yes | Create/update catalog item for checkout | Admin session and catalog permissions | Create or update Product + Price in admin; verify in public catalog | Catalog mutation succeeds and public pages reflect active offering correctly |
| AOP-002 | Admin | Critical | Yes | Create/update studio session | Admin session and class template/category exists | Create session; edit schedule/capacity; save | Session persists and appears in booking availability as expected |
| AOP-003 | Admin | Major | No | Create teacher user account | Admin session | Create teacher user and set credentials | Teacher user is created and can authenticate where applicable |
| AOP-004 | Admin | Major | No | Admin user update safety | Admin session and target user exists | Edit user profile/role metadata within allowed UI path | Update persists and no unauthorized mutation path is exposed |

### Teacher/Kiosk/Attendance

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| TCH-001 | Teacher | Critical | Yes | Kiosk session selection and collective check-in | `teacher_operator`; collective session in check-in window; booked client | Open kiosk flow; select session; perform check-in | Check-in succeeds for eligible collective booking in window |
| TCH-002 | Teacher | Critical | Yes | Kiosk exit requires password re-entry | Active kiosk session | Use kiosk exit action | Exit path requires credential/password re-entry before leaving kiosk mode |
| TCH-003 | Teacher | Critical | Yes | Check-in blocked outside configured window | Collective session outside check-in window | Attempt self/kiosk check-in | Server-side enforcement blocks check-in outside allowed window |
| TCH-004 | Teacher | Major | No | Private sessions excluded from self check-in paths | Private session exists | Open kiosk/check-in options for private session | Private class is excluded from self-check-in flow |

### Learning

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| LRN-001 | Client | Critical | Yes | Learning listing and detail navigation | Learning content seeded | Open `/learning`; navigate to a course/program detail | Listing and detail pages load with valid content routing |
| LRN-002 | Client | Major | No | Video playback auth gate | Signed-out then signed-in states available | Open learning video detail signed-out, then signed-in | Signed-out state is gated; signed-in user can access playback view |

### Inbox/Contact

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| INB-001 | Client/Admin | Critical | Yes | Public contact to admin inbox lifecycle | Public contact form and admin inbox available | Submit contact form from public page; open admin inbox | Message is stored and visible in admin inbox |
| INB-002 | Admin | Major | No | Inbox status update workflow | Existing inbox message | Change message status (e.g., OPEN to RESOLVED) | Status change persists and is visible on reload |

### Marketing

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| MKT-001 | Admin | Major | No | Campaign draft to send confirmation flow | Admin session and marketing seed audience | Create/update campaign and run send flow | Send workflow completes with expected status transition |
| MKT-002 | Admin | Exploratory | No | Unsubscribe/tracking endpoint sanity | Campaign link/tracking artifacts available | Execute unsubscribe or tracking URL from campaign artifact | Endpoint responds correctly and state update is consistent |

### Agenda/Public Document

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| AGD-001 | Admin | Critical | Yes | Upload/switch public agenda document | Admin session and valid document file | Upload or switch agenda/public document in admin | New active document persists and becomes current |
| AGD-002 | Client | Major | No | Public agenda document availability | Active public document exists | Open public agenda/document page | Active document is reachable and rendered/downloadable |

### Operational Confidence Checks

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| OPC-001 | Admin | Critical | Yes | Health endpoint readiness under UAT runtime | UAT app running | Call `/api/health` before and after core flow batch | Endpoint returns healthy response and no readiness regressions appear |
| OPC-002 | Admin | Major | No | Success page refresh idempotency | Completed booking and subscription success sessions | Refresh booking success and subscription success pages | No duplicate booking/order effects; reconciliation remains stable |
| OPC-003 | Admin | Exploratory | No | Error observability sanity during campaign | UAT run with monitoring enabled | Execute campaign and check operator-visible error signals/log dashboard | No untriaged critical runtime error spike during validation window |

## Exclusion Confirmation
- No-show operational flow: excluded for this campaign.
