# Customer-Side Beta Smoke Checklist

## Objective
Run a final manual validation of all customer-facing flows before beta.  
Focus only on **blocking issues**, not polish.

---

## Test Order

1. Home  
2. About Us (and all sub-pages)  
3. Book a Class  
4. Subscription  
5. Online Learning  
6. Sign-in / Sign-up  
7. Success / cancel / confirmed pages  
8. Dashboard  

---

## Environments

Run the full checklist on:
- Desktop (Chrome)
- Mobile (Chrome dev tools or real device)

---

## Test Profiles

Run key flows with:
- New user (no purchases)
- User with past purchases (no usable credits)
- User with active usable credits

---

## 1. Home

### Checks
- Header/navigation links route correctly
- Hero CTAs route correctly
- No broken images or empty sections
- Mobile layout is readable and usable

### Pass
- All links work
- All content visible and correctly aligned

### Fail (Blocker)
- Broken navigation
- Missing key section
- Layout prevents interaction


---

## 2. About Us (All Sub-pages)

### Checks
- All sub-pages accessible via navigation
- Breadcrumbs/back links work
- Content and images render properly
- Mobile readability

### Pass
- All pages load and are readable

### Fail (Blocker)
- 404 / blank page
- Clipped or overlapping content

---

## 3. Book a Class

### Checks
- Open service → select slot → proceed to booking
- Empty/no-slot state messaging is clear
- Signed-out user is redirected properly

### Payment Paths (MANDATORY)
- Book using plan (existing credits)
- Book without plan (checkout flow)

### Pass
- Both flows complete successfully
- No dead-ends
- Clear messaging in empty states

### Fail (Blocker)
- Cannot proceed or return
- Wrong redirect behavior
- Confusing or missing empty state

---

## 4. Subscription

### Checks
- Product list/cards render correctly
- Purchase flow works
- Success/cancel pages show correct state
- Navigation back to products/dashboard works

### Pass
- Products visible and selectable
- Clear success/cancel messaging

### Fail (Blocker)
- Missing products
- Broken CTA
- Incorrect success/cancel state

---

## 5. Online Learning

### Checks
- Landing page loads
- Program list loads
- Individual program/video page loads
- Pagination/filter works
- Empty states are clear

### Pass
- Navigation works consistently
- No blank or broken modules

### Fail (Blocker)
- Dead links
- Blank content sections
- Broken navigation

---


## 6. Sign-in / Sign-up

### Checks
- Form validation messages
- Safe callback behavior:
  - External callback → fallback to `/dashboard`
  - Internal callback → preserved
- Forgot-password flow accessible

### Pass
- Authentication works cleanly
- Redirects are correct

### Fail (Blocker)
- Redirect loop
- Unsafe redirect
- Cannot access auth actions

---

## 7. Success / Cancel / Confirmed Pages

### Pages to test
- Booking confirmed
- Payment success
- Payment cancel
- Subscription success
- Subscription cancel

### Checks
- Correct status messaging
- At least one clear next action (CTA)
- Copy is correct and consistent

### Refresh Test (MANDATORY)
- Refresh each page once

### Pass
- State remains consistent after refresh
- No duplicate actions or changes

### Fail (Blocker)
- Incorrect status
- Missing CTA
- Refresh causes inconsistent state

---

## 8. Dashboard

### Sections
- Overview
- Bookings
- Membership / Plans
- Profile

### Checks
- Data consistency across sections
- Credits match membership usable credits
- Empty states are explicit and clear
- Mobile layout usable

### User Scenarios (MANDATORY)
- First-time user (no data)
- User with past purchases (no usable credits)
- User with active credits

### Pass
- All sections load
- Values consistent across views
- No broken navigation

### Fail (Blocker)
- Inconsistent data
- Broken tabs or links
- Mobile unusable

---

## Beta Decision Criteria

### BLOCK BETA if:
- Any core flow has a dead-end or broken redirect
- Any main page returns 404 / blank / crash
- Mobile prevents key actions (book, sign in, navigate)
- Success/cancel/confirmed pages show incorrect state

### MONITOR LATER:
- Minor spacing/alignment issues
- Small copy improvements
- Visual inconsistencies
- Non-blocking UX polish

---

## Execution Notes

- Run once end-to-end
- Log only:
  - Blockers
  - Near-blockers
- Fix blockers immediately
- Do NOT reopen already validated systems (payments, webhook, auth hardening)

---

## Exit Criteria

- 0 blockers → Client side is DONE  
- 1–2 blockers → Fix → retest affected flows only  
- No blockers but minor issues → Proceed to Admin Dashboard work