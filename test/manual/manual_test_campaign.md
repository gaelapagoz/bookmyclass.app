# Operator-Run Manual Release Validation

## Purpose
Define operator-run manual release validation for active, production-critical and major flows across Client, Admin, and Teacher/kiosk usage in `studio.saas.platform`.

## Scope
This campaign validates only active runtime capabilities confirmed by baseline docs.
Store run evidence in `test-results/manual_test_<YYYY-MM-DD>.md`.
Store production readiness evidence must also be recorded in
`test-results/manual_test_<YYYY-MM-DD>_store_production_readiness.md`.

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
- Operator-approved target environment is reachable.
- Release tag/build is complete and smoke endpoints respond.
- Required seeded accounts and data are available (client/admin/teacher).
- Stripe test mode credentials and test cards are available for operator checkout checks.
- No critical infra incident is active (DB, app runtime, webhook endpoint).

## Exit Criteria
- All release-blocking tests pass.
- No open S1 or S2 defects.
- Any S3/S4 defects are documented with owner and target fix decision.
- Evidence is attached for each release-blocking case.
- Operator signoff checklist is completed in `test-results/manual_test_<YYYY-MM-DD>.md`.

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
- Active Store Gift Card products for EUR 25, EUR 50, and EUR 100.
- At least three active Store Merchandise products with checkout-ready prices.
- Store products/prices are Product + Price rows with `StripeSyncStatus.SYNCED`.
- Gift-card email delivery/outbox evidence is available to the operator.
- At least one issued, unredeemed gift-card code for redemption checks.
- At least one redeemed gift-card wallet ledger entry for wallet history checks.
- Two verified client accounts are available for IDOR and duplicate redemption checks.
- Admin Store catalog access is available for merchandise, gift cards, and images.
- `client_loyalty_earner`: verified active client with zero or known baseline points and access to an eligible one-time product purchase path.
- `client_loyalty_reward_ready`: verified active client with enough points for at least one active loyalty reward redemption.
- `client_loyalty_with_credit`: verified active client with an existing loyalty credit balance for checkout application checks.
- `client_loyalty_expiring`: verified active client with points inside the configured reminder/expiration window.
- `client_loyalty_ineligible`: inactive or unverified client account for loyalty access and mutation rejection checks.
- Active loyalty program configuration exists with a known earning ratio, reminder window, and expiration policy.
- At least one active loyalty reward definition exists in the primary loyalty currency.
- At least one checkout-ready eligible one-time loyalty product exists.
- At least one checkout-ready recurring product exists for loyalty-credit rejection checks.
- Operator can trigger or observe `GET /api/cron/maintenance` for loyalty expiration, reminder, and stale reservation validation.
- At least one full collective session with waitlist capacity available.
- At least one full collective session with waitlist already full.

## Recommended Execution Order
1. UAT smoke
2. Client auth
3. Client booking
4. Client waitlist
5. Client subscription/membership
6. Store checkout and gift-card lifecycle
7. Store dashboard and history
8. Client loyalty
9. Store admin/catalog/media
10. Store security
11. Loyalty security and maintenance
12. Client dashboard/profile/security
13. Admin auth/access
14. Admin catalog/session/user operations
15. Admin loyalty operations
16. Teacher/kiosk/attendance
17. Learning
18. Inbox/contact
19. Marketing
20. Agenda/public document
21. Store production readiness
22. Operational confidence checks

## Release-Blocking Subset
`SMK-001`, `SMK-002`, `AUT-001`, `AUT-002`, `AUT-003`, `BKG-002`, `BKG-003`, `BKG-004`, `BKG-005`, `BKG-006`, `BKG-007`, `WTL-001`, `WTL-002`, `WTL-003`, `SUB-001`, `SUB-002`, `STR-001`, `STR-002`, `STR-003`, `STR-004`, `STR-005`, `STR-006`, `STR-007`, `STR-008`, `STH-001`, `STH-002`, `LYT-002`, `LYT-003`, `LYT-004`, `LYT-005`, `LYT-006`, `STA-001`, `STA-002`, `STS-001`, `STS-002`, `STS-003`, `LYS-001`, `LYS-002`, `LYS-003`, `SPR-001`, `SPR-002`, `SPR-003`, `SPR-004`, `DBO-001`, `ADM-001`, `ADM-002`, `AOP-001`, `AOP-002`, `LYA-001`, `LYA-002`, `LYA-003`, `TCH-001`, `TCH-002`, `TCH-003`, `LRN-001`, `INB-001`, `AGD-001`, `OPC-001`

## Known Baseline Risks
- Teacher workflow enforcement is a known risk area; execute teacher/kiosk tests with strict evidence capture and do not over-assume role gating behavior.
- Server-side rules are authoritative; UI behavior that appears valid must still match backend enforcement outcomes.
- Product + Price is the catalog source of truth; any mismatch between catalog display and checkout behavior is an S2.
- Gift-card wallet balance is credited only after code redemption, never at purchase.
- Plaintext gift-card codes must appear only in purchaser email/outbox evidence.
- Loyalty public messaging must match the active spend-earning plus redeem-to-credit contract; stale read-only-only copy is a release risk.
- Loyalty credit and gift-card wallet are intentionally separate mutation domains even when shown on the same wallet or checkout surface.
- Store production signoff is invalid without the Store readiness evidence file.

## Manual Campaign

### Smoke

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| SMK-001 | Admin | Critical | Yes | Core endpoints respond | Target deployed | Call `/api/health`, `/`, `/sign-in`, `/book-a-class`, `/subscription`, `/promos/loyalty-points`, `/api/categories` | All endpoints return expected success (`200`; health ready) and pages render usable content |
| SMK-002 | Admin | Critical | Yes | Smoke command pass | Target deployed and operator shell access | Run `npm run test:uat:smoke` against operator-approved URL | Smoke command exits successfully with no failed check |

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

### Store Checkout and Gift-Card Lifecycle

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| STR-001 | Client | Critical | Yes | Merchandise purchase via Stripe | Signed-in verified client; checkout-ready merchandise product; Stripe test/live mode per target | Open `/store`; add merchandise; complete Stripe checkout; return to `/store/success` | Order is paid, purchased cart line is cleared, merchandise purchase is visible, and pickup-at-studio wording is shown |
| STR-002 | Client | Critical | Yes | Gift-card purchase via Stripe issues code | Signed-in verified client; checkout-ready gift-card price; email/outbox access | Buy gift card from `/store`; complete Stripe checkout; inspect success page and purchaser email/outbox | GiftCardCode is issued after payment, purchaser receives plaintext code and amount by email, and wallet is not credited at purchase |
| STR-003 | Client | Critical | Yes | Gift-card full-wallet purchase if enabled | Client has available wallet balance; full-wallet Store checkout path available | Buy gift card using wallet-only payment; open `/store/success?orderId=...` | Order completes without Stripe redirect, cart line clears, code is issued, and no duplicate wallet credit occurs |
| STR-004 | Client | Critical | Yes | Failed or expired Store checkout retains cart | Signed-in client with Store cart item; test failed/expired checkout path available | Start Store checkout; fail or expire payment; return/cancel | Order is not completed, cart item remains, and no GiftCardCode is issued |
| STR-005 | Client | Critical | Yes | Purchaser can redeem own gift-card code | Purchaser has issued unredeemed code | Open dashboard wallet; redeem code | Wallet balance increases only after redemption, ledger entry is recorded, and code becomes redeemed |
| STR-006 | Client | Critical | Yes | Second client cannot redeem already redeemed code | Same code from `STR-005`; second verified client | Sign in as second client; attempt redeeming same code | Duplicate redemption is rejected with a safe generic error and no wallet balance change |
| STR-007 | Client | Critical | Yes | Invalid and voided code errors do not reveal status | Verified client; invalid code and voided/expired code available if applicable | Attempt redemption with invalid and voided/expired codes | Client receives the same safe generic error without existence/status leakage |
| STR-008 | Client | Critical | Yes | Gift-card purchase email code secrecy | Completed gift-card purchase; access to logs/outbox/Sentry evidence | Inspect purchaser email/outbox and operator-visible logs/errors for the flow | Plaintext code appears in purchaser delivery only; no plaintext code appears in logs, Sentry, or API responses |

### Store Dashboard and History

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| STH-001 | Client | Critical | Yes | Dashboard wallet reflects redeemed codes only | Client with issued unredeemed code and one redeemed code | Open dashboard wallet before and after redemption | Empty/unredeemed purchase does not credit wallet; redeemed code appears in balance and ledger history |
| STH-002 | Client | Critical | Yes | Store purchases appear in order history | Client has merchandise and gift-card orders | Open `/dashboard/orders` or purchase history surface | Merchandise and gift-card purchases show date, item, quantity, total, payment status, and fulfillment note |
| STH-003 | Client | Major | No | Store product images render in purchase history | Purchased product has uploaded image; another product has none | Open purchase history | Uploaded image displays where available; placeholder displays where absent; no broken image appears |

### Client Loyalty

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| LYT-001 | Client | Major | No | Public loyalty explainer matches active scope | Public site reachable | Open `/promos/loyalty-points`; review hero, steps, and CTA copy | Public explainer loads successfully and describes active spend-based earning plus loyalty-credit redemption scope without implying sign-up or booking earning |
| LYT-002 | Client | Critical | Yes | Dashboard and wallet show loyalty balances and history | `client_loyalty_reward_ready` or client with seeded loyalty activity | Sign in; open dashboard overview and wallet page | Dashboard shows loyalty summary, wallet shows separate loyalty points, loyalty credit, expiry visibility, and history without merging values into gift-card balance |
| LYT-003 | Client | Critical | Yes | Reward redemption converts points into loyalty credit | `client_loyalty_reward_ready`; active reward definition | Open wallet; redeem one reward; refresh wallet/history | Points decrease once, loyalty credit increases by the reward amount, reward action is recorded in history, and duplicate clicks/retry do not double-redeem |
| LYT-004 | Client | Critical | Yes | Loyalty credit applies to eligible one-time checkout in the correct order | `client_loyalty_with_credit`; eligible one-time cart item; coupon and gift-card wallet value available if stacking is seeded | Build eligible cart; apply coupon if available; apply loyalty credit; apply gift-card wallet if available; complete checkout; open success page | Checkout applies funding in the order `coupon -> loyalty credit -> gift-card wallet -> Stripe/card remainder`, succeeds, and success summary shows each contribution as a separate line |
| LYT-005 | Client | Critical | Yes | Recurring cart rejects loyalty credit before checkout | `client_loyalty_with_credit`; checkout-ready recurring product exists | Add recurring product to cart; attempt to apply loyalty credit | Client gets a safe rejection before reservation/checkout and recurring purchase path remains intact without consuming loyalty credit |
| LYT-006 | Client | Critical | Yes | Eligible settled one-time purchase earns points only after settlement | `client_loyalty_earner`; eligible one-time product; Stripe test data | Record starting balance; complete eligible paid order; refresh dashboard/wallet after settlement | Points are absent before settlement, appear once after successful settlement, and earned amount matches the configured net paid eligible spend |
| LYT-007 | Client | Major | No | Failed or expired checkout does not earn points | `client_loyalty_earner`; eligible one-time product; failed or expired checkout path available | Start eligible checkout; fail or abandon until expiry; inspect wallet/history | No new loyalty award is created and any temporary loyalty credit reservation is released safely if one existed |
| LYT-008 | Client | Major | No | Gift-card-funded or loyalty-funded amount does not earn extra points | `client_loyalty_with_credit`; client with gift-card wallet balance; eligible one-time product | Complete one or more eligible orders using loyalty credit and/or gift-card wallet for part of the total; inspect resulting points award | Earned points are based only on the settled net cash/card-paid eligible amount and exclude loyalty-funded or gift-card-funded portions |

### Store Admin, Catalog, and Media

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| STA-001 | Admin | Critical | Yes | Admin creates Store product and sync readiness is visible | Admin session; Stripe catalog sync path available | Create merchandise and gift-card catalog entries; inspect admin Store list | Items remain Product + Price rows, readiness status is visible, and checkout exposure requires synced Stripe price |
| STA-002 | Admin | Critical | Yes | Admin can edit merchandise price with history preserved | Existing merchandise product with historical order | Edit merchandise price in admin; inspect old order and new checkout price | New Price record or historical-safe update is used; old order retains original amount |
| STA-003 | Admin | Major | No | Admin Store image workflow | Admin session; valid JPEG/PNG/WebP and invalid SVG/oversized files | Upload, preview, replace, remove product image for merchandise and gift card; attempt invalid uploads | Valid image operations work; invalid MIME/extension/size/path attempts are rejected server-side |

### Store Security

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| STS-001 | Client | Critical | Yes | Store order IDOR is blocked | Client A has Store order; Client B exists | Sign in as Client B; attempt Client A order/success/history URLs | Access is denied or not found; Client B cannot see Client A order data |
| STS-002 | Client | Critical | Yes | Wallet IDOR is blocked | Client A has wallet activity; Client B exists | Sign in as Client B; attempt wallet/API access for Client A | Client B sees only own wallet; no other-client wallet data leaks |
| STS-003 | Client | Critical | Yes | Redemption response hides purchaser identity and code hash | Valid code purchased by Client A; Client B redeems | Redeem as Client B; inspect UI/API response | Redeemer cannot see purchaser identity, order data, or `GiftCardCode.codeHash` |
| STS-004 | Admin/Client | Major | No | Upload route authorization and validation | Non-admin user and admin user available | Attempt product image upload as anonymous/client/admin with unsafe file variants | Anonymous/client upload is rejected; admin valid upload succeeds; unsafe files are rejected |

### Loyalty Security and Maintenance

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| LYS-001 | Client | Critical | Yes | Loyalty wallet and history ownership is enforced | Client A has loyalty points/credit/history; Client B exists | Sign in as Client B; attempt Client A loyalty wallet/history or API access | Access is denied or not found; Client B cannot view or mutate Client A loyalty data |
| LYS-002 | Client | Critical | Yes | Loyalty redemption requires authenticated verified active client | `client_loyalty_ineligible` and anonymous session available; active reward exists | Attempt wallet/redeem access while signed out, unverified, or inactive | Signed-out access is rejected, inactive/unverified client cannot redeem, and no points or credit mutate |
| LYS-003 | Admin/System | Critical | Yes | Loyalty maintenance expires and reminds without duplicate effects | `client_loyalty_expiring`; maintenance access available | Trigger or observe `GET /api/cron/maintenance`; inspect loyalty history, reminder delivery evidence, and rerun behavior for the same effective window | Reminder/expiration effects occur when due, balances/read models update correctly, and replay does not duplicate reminder or expiration entries |
| LYS-004 | Client/System | Major | No | Failed loyalty-funded cart releases reserved loyalty credit | `client_loyalty_with_credit`; eligible one-time product; failure path available | Start checkout with loyalty credit applied; fail or expire the checkout; inspect wallet and retry | Reserved loyalty credit is released once after failure/expiry and client can reuse the credit on a later eligible checkout |

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

### Admin Loyalty Operations

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| LYA-001 | Admin | Critical | Yes | Sales loyalty page shows balances, history, and client search | Admin session; at least one client with loyalty activity | Open `/admin/sales/loyalty`; search for a client; inspect overview and client detail panels | Admin can find loyalty clients, see read-only balances/history, and overview totals render without exposing mutation paths outside approved actions |
| LYA-002 | Admin | Critical | Yes | Manual grant requires active verified client and reason | Admin session; `client_loyalty_earner`; inactive or unverified client also available | Submit a valid manual grant with reason to eligible client; attempt grant to inactive/unverified client or without reason | Eligible grant succeeds once with audit-visible history, invalid targets/reasonless attempts are rejected, and no negative adjustment path is exposed |
| LYA-003 | Admin | Critical | Yes | Catalog loyalty configuration and rewards match frozen scope | Admin session; active loyalty program and reward definitions exist | Open `/admin/catalog/loyalty`; inspect earning settings, expiration/reminder controls, and reward definitions | Admin can view/manage spend-based earning, expiration, and rewards; UI does not expose `Sign up to the site` or `Book a session` earning actions |
| LYA-004 | Admin | Major | No | Loyalty reward edits preserve client-facing redemption safety | Admin session; existing active reward definition | Create, update, and archive a reward definition; revisit client wallet reward list | Admin changes persist safely and client wallet only shows currently active valid rewards |

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

### Store Production Readiness

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| SPR-001 | Admin | Critical | Yes | Catalog sync and readiness evidence | Operator shell on target env; correct Stripe mode selected | Run `npm run stripe:catalog:sync -- --scope=all --dry-run`; if live launch approved run actual sync with explicit confirmation; run `npm run verify:catalog:production` | Dry-run result is recorded, actual sync result is recorded if run, and catalog readiness verifier passes |
| SPR-002 | Admin | Critical | Yes | Canonical E2E suite includes Store | E2E env configured | Run `npm run verify:e2e-config`, `npm run test:e2e`, and `npm run qa:e2e:coverage` | Config verifier passes, full canonical E2E passes with Store flows included, and no critical Store flows are silently skipped |
| SPR-003 | Admin | Critical | Yes | Gift-card maintenance route and schedule verified | Target app running; `CRON_SECRET`; maintenance enabled | Run `npm run verify:gift-card-maintenance`; configure scheduler for `GET /api/cron/gift-cards/maintenance` with bearer header; observe a successful run | Valid secret succeeds, invalid/missing secret rejects, schedule is configured, and last successful run is recorded |
| SPR-004 | Admin | Critical | Yes | Store launch operator confirmations recorded | Store readiness evidence template exists | Fill `test-results/manual_test_<YYYY-MM-DD>_store_production_readiness.md` | Evidence includes live Stripe confirmation, no test Stripe IDs, maintenance verification/schedule status, and operator signoff |

### Operational Confidence Checks

| Test ID | Persona | Priority | Release Blocking | Title | Preconditions | Steps | Expected Result |
|---|---|---|---|---|---|---|---|
| OPC-001 | Admin | Critical | Yes | Health endpoint readiness under target runtime | Target app running | Call `/api/health` before and after core flow batch | Endpoint returns healthy response and no readiness regressions appear |
| OPC-002 | Admin | Major | No | Success page refresh idempotency | Completed booking and subscription success sessions | Refresh booking success and subscription success pages | No duplicate booking/order effects; reconciliation remains stable |
| OPC-003 | Admin | Exploratory | No | Error observability sanity during validation | Target run with monitoring enabled | Execute validation and check operator-visible error signals/log dashboard | No untriaged critical runtime error spike during validation window |

## Exclusion Confirmation
- No-show operational flow: excluded for this campaign.
