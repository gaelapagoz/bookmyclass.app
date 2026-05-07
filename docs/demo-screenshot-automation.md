# Demo Screenshot Automation

Playwright-based screenshot automation that produces ordered, brochure-quality
images of the two main user flows: **client booking** and **admin studio
operations**. It is completely separate from the E2E test suite and has no
effect on `npm run test:e2e` or CI gates.

---

## Quick start

```bash
# 1. Copy the example env file and fill in real values
cp .env.demo.example .env.demo

# 2. Run the automation
dotenv -e .env.demo -- npm run demo:screenshots
```

Or export the variables directly in your shell and run:

```bash
npm run demo:screenshots
```

---

## Environment variables

| Variable              | Required | Default                          | Description |
|-----------------------|----------|----------------------------------|-------------|
| `DEMO_BASE_URL`       | No       | `http://127.0.0.1:3100`          | Target environment URL |
| `DEMO_CLIENT_EMAIL`   | No       | `client.e2e@bookmyclass.local`   | Client account email |
| `DEMO_CLIENT_PASSWORD`| No       | `E2EPass123!`                    | Client account password |
| `DEMO_ADMIN_EMAIL`    | No       | `admin.e2e@bookmyclass.local`    | Admin account email |
| `DEMO_ADMIN_PASSWORD` | No       | `E2EPass123!`                    | Admin account password |
| `DEMO_SERVICE_SLUG`   | No       | `e2e-flow-class`                 | URL slug of the class used in the booking flow |

The defaults point at the seeded E2E accounts, which are only present when
running against the local E2E environment (`APP_URL=http://127.0.0.1:3100`).
For UAT/demo validation, the operator supplies the approved deployed URL and
matching seeded credentials manually.

---

## Running against a local E2E environment

Start the app with the E2E database first (the same way `npm run test:e2e` does
internally), then run the demo script against it:

```bash
# Terminal 1 – start the E2E app
npm run db:e2e:setup
dotenv -e .env.e2e -- npm run build
dotenv -e .env.e2e -- npm run start

# Terminal 2 – run screenshots (override base URL to local)
DEMO_BASE_URL=http://127.0.0.1:3100 npm run demo:screenshots
```

---

## Output

| Path | Content |
|------|---------|
| `artifacts/demo-screenshots/images/` | All PNG screenshots |
| `artifacts/demo-screenshots/report/` | HTML Playwright report |
| `artifacts/demo-screenshots/traces/` | Playwright traces for failed specs |

The `artifacts/` directory is created automatically on first run and should be
added to `.gitignore` if not already present.

---

## Screenshots generated

### Client flow – "Book a class"

| File | Description |
|------|-------------|
| `client-01-public-home.png` | Public landing / discovery page |
| `client-02-book-a-class.png` | Class catalogue / browse page |
| `client-03-class-detail-or-slot-selection.png` | Service detail with session slot picker |
| `client-04-client-sign-in.png` | Sign-in page (form empty, no credentials visible) |
| `client-05-payment-options.png` | Booking form showing payment option selection |
| `client-06-checkout-handoff-or-confirmation.png` | Post-CTA: Stripe hosted checkout **or** in-app confirmation |
| `client-07-client-dashboard-bookings.png` | Client dashboard – bookings tab |

### Admin flow – "Operate the studio"

| File | Description |
|------|-------------|
| `admin-01-admin-login.png` | Admin sign-in page (form empty) |
| `admin-02-admin-dashboard.png` | Admin dashboard landing |
| `admin-03-admin-schedule-classes.png` | Sessions / schedule management |
| `admin-04-admin-products-subscriptions.png` | Plans / pricing / subscriptions |
| `admin-05-admin-users.png` | Users / client management list |
| `admin-06-admin-learning-content.png` | Learning programs management |
| `admin-07-admin-marketing-inbox.png` | Marketing campaigns |

---

## Spec files

```
test/manual/demo-screenshots/
├── helpers.ts           # Shared auth helpers and capture() utility
├── client-flow.spec.ts  # 7 client screenshots
└── admin-flow.spec.ts   # 7 admin screenshots
```

Config: [`playwright.demo.config.ts`](../playwright.demo.config.ts)  
Output: `artifacts/demo-screenshots/`  
Viewport: 1440 × 900 (desktop, optimised for brochure use)

---

## Known limitations

1. **Stripe checkout not completed.** For paid booking flows the script clicks
   "Continue To Secure Checkout", which redirects to Stripe's hosted checkout
   page. The script screenshots that page but does not enter card details or
   complete the payment. Screenshot 06 may therefore show either Stripe's
   checkout UI or an in-app redirect/loading state depending on the environment.

2. **Slots must be available.** Screenshot 05 requires at least one bookable
   session slot for `DEMO_SERVICE_SLUG`. If no slots are available (all full,
   all in the past, or the slug doesn't exist), screenshot 05 will show the
   class page without a booking form and 06 will be identical to it.

3. **Seeded data on local E2E.** When running against the local E2E database,
   all visible data is seeded test data (fake names, local email addresses).
   This is intentional and safe for demo screenshots.

4. **Admin pages may show seeded email addresses.** The admin users list
   (`admin-05`) will display the email addresses of seeded accounts. Run only
   against environments whose data you are permitted to capture.

5. **Cookie consent / popups.** If the target environment shows a cookie-consent
   banner or marketing popup, it may appear in screenshots. Dismiss it manually
   before running, or add a pre-run dismissal step in `helpers.ts`.

6. **`networkidle` on data-heavy pages.** Some admin pages with live queries may
   never fully reach `networkidle`. The script uses a 60-second timeout per test
   with 1 retry; if a page consistently times out, reduce the `waitForLoadState`
   call to `"domcontentloaded"` for that spec.

---

## How it is isolated from the E2E test suite

- `playwright.config.ts` sets `testDir: "./test/e2e"` — it never touches
  `test/manual/`.
- `playwright.demo.config.ts` sets `testDir: "./test/manual/demo-screenshots"`.
- `npm run test:e2e` invokes `playwright test` which uses `playwright.config.ts`
  by default; it never picks up the demo config.
- The demo specs contain no correctness assertions that could gate CI.
