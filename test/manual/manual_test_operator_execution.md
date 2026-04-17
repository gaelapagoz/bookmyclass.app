# Operator Execution Checklist - Manual UAT Campaign

## Environment Confirmation
- Target environment: `https://uat.bookmyclass.app`
- Confirm deployed tag/version: `_____________`
- Confirm date/time (UTC): `_____________`
- Confirm operator: `_____________`

## Required Accounts and Seed Data
- Client accounts:
  - `client_new`
  - `client_verified`
  - `client_with_collective_credit`
  - `client_with_active_membership`
  - `client_with_booking_early_cancel`
  - `client_with_booking_late_cancel`
  - `client_waitlist_candidate`
  - `client_waitlist_ineligible`
  - `client_waitlist_monthly_unlimited`
- Staff accounts:
  - `admin_operator`
  - `teacher_operator`
- Seed/session data:
  - At least one active collective class/session
  - At least one collective session inside check-in window
  - At least one collective session outside check-in window
  - At least one private session
  - At least one active Product + Price visible on `/subscription`
  - At least one full collective session with waitlist space
  - At least one full collective session with waitlist full
- Payments:
  - Stripe test mode available
  - Test card data available to operator

## Pre-Run Setup
1. Confirm smoke endpoints are reachable (`/api/health`, `/`, `/sign-in`, `/book-a-class`, `/subscription`, `/api/categories`).
2. Confirm inbox and learning seed content exists.
3. Confirm admin access to catalog/session/user operations.
4. Confirm teacher/kiosk credentials and test session assignment.
5. Confirm evidence storage location (screenshots/video/log links): `_____________`.
6. Open manual campaign tracker and evidence log: `test/manual/manual_test_campaign.md`.

## Execution Order
1. UAT smoke (`SMK-*`)
2. Client auth (`AUT-*`)
3. Client booking (`BKG-*`)
4. Client waitlist (`WTL-*`)
5. Client subscription/membership (`SUB-*`)
6. Client dashboard/profile/security (`DBO-*`)
7. Admin auth/access (`ADM-*`)
8. Admin catalog/session/user operations (`AOP-*`)
9. Teacher/kiosk/attendance (`TCH-*`)
10. Learning (`LRN-*`)
11. Inbox/contact (`INB-*`)
12. Marketing (`MKT-*`)
13. Agenda/public document (`AGD-*`)
14. Operational confidence checks (`OPC-*`)

## Evidence Capture Rules
- Capture evidence for every release-blocking test.
- Minimum evidence per failed test:
  - timestamp
  - test ID
  - account used
  - URL
  - screenshot or screen recording
  - visible error message/response
- For checkout and reconciliation flows, capture:
  - pre-action screen
  - provider return/success screen
  - final dashboard/admin state
- For policy-sensitive flows (private self-book block, cancellation cutoff, check-in window), capture full before/after state.
- For waitlist-sensitive flows, capture:
  - full-slot state before join
  - join action result
  - dashboard waitlist entry state
  - cancellation/promotion outcome and resulting booking state

## Defect Logging Rules
- Log each defect with:
  - test ID
  - severity (`S1`/`S2`/`S3`/`S4`)
  - exact reproduction steps
  - expected vs actual result
  - evidence link(s)
- Severity handling:
  - `S1`/`S2`: immediate release stop until triaged and resolved or formally waived by release owner.
  - `S3`: release decision required with documented workaround.
  - `S4`: log for post-release unless volume/pattern indicates larger risk.
- Do not merge multiple unrelated failures into one defect ticket.

## Go / No-Go Decision Checklist
- [ ] All release-blocking test IDs passed.
- [ ] No open `S1` defects.
- [ ] No open `S2` defects.
- [ ] Exclusions respected (no-show not validated in this pass).
- [ ] Waitlist critical flows passed (`WTL-001`, `WTL-002`, `WTL-003`).
- [ ] Waitlist major flows reviewed and disposition recorded (`WTL-004`, `WTL-005`, `WTL-006`).
- [ ] No-show exclusions respected.
- [ ] Teacher/kiosk checks executed with explicit evidence and reviewed due to known enforcement risk.
- [ ] Product + Price catalog behavior validated in booking/subscription paths.
- [ ] Cancellation policy behavior validated (early restore, late no-restore).
- [ ] Health endpoint remained stable during test window.

Decision:
- [ ] GO
- [ ] NO-GO

Release owner: `_____________`
Date/time: `_____________`

## Final Signoff
- Operator name: `_____________`
- QA/UAT reviewer: `_____________`
- Engineering approver: `_____________`
- Product approver: `_____________`
- Notes: `____________________________________________________________`
