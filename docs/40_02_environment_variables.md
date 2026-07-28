# Environment Variables

Purpose: define environment-variable expectations by runtime context using repository truth.

## Production/Core Runtime (Code-Required)
- `DATABASE_URL`
- `AUTH_SECRET`
- `APP_URL`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CRON_SECRET` - required bearer token for cron-only maintenance routes.
- `UPLOADS_DIR` - required in production. Must point to a persistent filesystem directory outside the checked-out app/release folder, for example `/var/lib/bookmyclass/uploads`.

## Media Uploads
- `UPLOADS_DIR` controls where uploaded teacher, booking service, online learning, and Store product image media is written. In local/dev only, the app falls back to `.local/uploads`; the App Router `/uploads/...` route serves those files locally.
- `PUBLIC_UPLOADS_BASE_PATH` is optional and defaults to `/uploads`. Production nginx must serve this path with an `alias` to `UPLOADS_DIR`.
- Production must not set `UPLOADS_DIR` to the repository folder, `.next`, or `public`; runtime validation rejects release-local storage.
- Uploaded image records store public paths such as `/uploads/teachers/<file>.png`, `/uploads/classes/<file>.png`, `/uploads/learning/<file>.png`, and `/uploads/products/<file>.png`, never absolute filesystem paths.
- Production backup/restore must include both the database and the uploaded media directory. Restoring the DB without `UPLOADS_DIR` contents can leave product image references broken.

## Email Delivery
- Provider send path uses:
  - `RESEND_API_KEY`
  - `EMAIL_FROM`
  - `MARKETING_TRACKING_SECRET`
- Primary operator control for automation-backed email is Admin -> Automations status (`EmailTemplate.isActive`).
- Newly provisioned canonical automation templates are active by default, including clean development, staging/performance, and E2E seeds.
- Administrators can pause individual automations afterward; normal runtime reconciliation and production-safe upsert seeds preserve existing Active/Paused choices.
- Real provider delivery is enabled by default only in production.
- Non-production runtime defaults to suppressed/captured email delivery unless:
  - `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1`
- Homesite contact form send path also requires:
  - `CONTACT_FORM_TO_EMAIL`
  - Expected configured value: `gaelapagoz@gmail.com`
- In production, sender policy is enforced in code: sender must use verified `@bookmyclass.app` domain when provider delivery is used.
- `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION` is a secondary safety-net override for provider delivery in non-production, especially direct send paths outside Automations.
- Localhost real-delivery checklist:
  - `APP_URL=http://localhost:3000`
  - `EMAIL_FROM` set to a sender accepted by the configured Resend account
  - `RESEND_API_KEY`
  - `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1`
  - `CRON_SECRET` if you want to drive dispatch through `GET /api/cron/maintenance`
- Localhost dispatch options:
  - `npm run email:dispatch:local`
  - `curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/maintenance`
- Without `ALLOW_REAL_EMAILS_IN_NON_PRODUCTION=1`, non-production runs still enqueue and mark events through the canonical email layer, but provider delivery is suppressed and captured locally for safety.
- Canonical email architecture is unconditional: there are no `ENABLED`, `PAUSED`, or `DISABLED` environment variables for email architecture or email families.

## Contact Form Abuse Guard
- `TRUST_X_FORWARDED_FOR` (optional, default fail-closed when unset)
- Purpose: allows homesite contact-form throttling to consume `x-forwarded-for` as client-IP source.
- Security rule: enable only when ingress/proxy sanitizes and overwrites forwarded headers. Otherwise keep unset so production trusts only `cf-connecting-ip` or `x-real-ip`.

## Test / E2E Runtime
- Deterministic email bypass is enabled by `NODE_ENV=test` or `E2E_TEST_MODE=1`.
- Test/e2e runs do not require real provider delivery to be deterministic.
- E2E helper security expects `E2E_TEST_SECRET`.
- E2E seed and runtime server must use the same upload root (`UPLOADS_DIR`) so seeded Store media and runtime media resolve identically (recommended: `./.local/e2e-uploads`).

## Observability (Optional/Environment-Specific)
- Sentry variables are optional and used when configured (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, environment/release metadata vars).

## Security Headers
- `CSP_HEADER_MODE` (optional): controls CSP header emission mode in middleware.
- `ALLOW_CSP_REPORT_ONLY_IN_UAT` (optional): explicit UAT-only override gate for production runtimes.
- Allowed values:
  - `report-only` -> emits `Content-Security-Policy-Report-Only`
  - `enforce` -> emits `Content-Security-Policy`
- Default/fallback: `enforce` when unset or invalid.
- Precedence:
  - `NODE_ENV=production` => enforce by default.
  - Exception: `report-only` is allowed only when `CSP_HEADER_MODE=report-only` and `ALLOW_CSP_REPORT_ONLY_IN_UAT=1` and request host is UAT (`uat.*`).
  - Non-production runtime follows `CSP_HEADER_MODE` with enforce fallback.
- UAT rollout rule: set `CSP_HEADER_MODE=report-only` and `ALLOW_CSP_REPORT_ONLY_IN_UAT=1`, validate compatibility routes, then switch to `enforce`.

## Cron Maintenance
- `GET /api/cron/gift-cards/maintenance` requires `Authorization: Bearer $CRON_SECRET`.
- The route releases expired `RESERVED` gift-card redemptions only; reconciliation retry is not active in this slice.
- Schedule only after operator confirmation that `CRON_SECRET` is configured in the target environment.

## Store Stripe Price IDs
Used at seed time to mark store product prices as checkout-ready (`StripeSyncStatus.SYNCED`).
If omitted in development, store products are seeded with `PENDING` status and will not appear on the client `/store` until provided and seed is re-run.
In production, all 12 `STRIPE_PRICE_ID_*` values are required and the seed fails fast if any are missing or malformed.

**Subscription/class prices (required in all seed modes):**
- `STRIPE_PRICE_ID_COLLECTIVE_DROP_IN`
- `STRIPE_PRICE_ID_COLLECTIVE_5_PACK`
- `STRIPE_PRICE_ID_COLLECTIVE_10_PACK`
- `STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE`
- `STRIPE_PRICE_ID_PRIVATE_5_PACK`
- `STRIPE_PRICE_ID_PRIVATE_10_PACK`

**Store gift card prices (required in production; optional in development/staging/demo — PENDING when omitted):**
- `STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR`
- `STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR`
- `STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR`

**Store merchandise prices (required in production; optional in development/staging/demo — PENDING when omitted):**
- `STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT`
- `STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS`
- `STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE`

## Seed Media Source Of Truth
- Seed image source-of-truth is mode-scoped under `prisma/seed-data/<mode>-images/*`.
- Canonical mode folders are `dev-images`, `staging-images`, `demo-images`, and `prod-images`.
- Seed and reseed flows must not rely on legacy `public/images` seed image folders.

## Seed/Test Helpers
- `.env.test.example` defines integration-test baseline.
- `.env.e2e.example` defines E2E baseline including fake store price IDs for the test Stripe key.
- `STRIPE_PRICE_ID_*` mappings are seed/bootstrap-only inputs and are not read by runtime checkout paths.

## Runtime Boundary
- Runtime checkout (`booking`, `subscription`, `cart`) resolves Stripe price references from DB `Price.stripePriceId` only.
- Runtime must not rely on env-based Stripe price lookup mappings.

## Stripe Catalog Sync Script (`stripe:catalog:sync`)

`scripts/catalog-server-sync-stripe.ts` reads the local DB catalog and creates or reuses
Stripe Products/Prices. It requires only `DATABASE_URL` and `STRIPE_SECRET_KEY` at
run time — no `STRIPE_PRICE_ID_*` env vars needed.

**Required at runtime:**
- `DATABASE_URL` — Prisma connection string.
- `STRIPE_SECRET_KEY` — must start with `sk_test_` (test mode) or `sk_live_` (live mode).

**Stripe key permissions required (restricted key):**
- Products: read + write
- Prices: read + write
- No webhook, billing portal, or checkout permissions needed.

**Modes and flags:**
```
# Test mode — dry-run (default safe entry point)
npm run stripe:catalog:sync -- --scope=all --dry-run

# Test mode — apply changes
npm run stripe:catalog:sync -- --scope=all

# Store products only
npm run stripe:catalog:sync -- --scope=store

# Plans/class products only
npm run stripe:catalog:sync -- --scope=plans

# Live mode — dry-run preview (no mutations)
npm run stripe:catalog:sync -- --scope=all --dry-run

# Live mode — real mutations (requires explicit flag)
npm run stripe:catalog:sync -- --scope=all --confirm-live
```

**Safety rules:**
- Live mode requires `--confirm-live` or the script aborts.
- `--dry-run` prints what would happen without touching Stripe or DB.
- `STRIPE_SECRET_KEY` is never logged.
- `StripeSyncStatus.SYNCED` is only written after Stripe confirms the price exists.
- Existing Stripe prices are never silently overwritten (amount/currency/interval are immutable).

**Rollback/verification:**
- The script is idempotent: re-running it produces the same result.
- On mismatch error: inspect the local Price record and the Stripe dashboard manually.
- For a changed amount: create a new Price record (new `lookupKey`) in the DB rather than
  editing the existing one. Stripe prices are immutable.
- After a successful sync, store products appear on `/store` immediately (no restart needed).
- After a successful sync, subscription/class prices appear in checkout immediately.

## Store and Gift Card Runtime Model

Store browsing, gift-card purchase, gift-card redemption, merchandise checkout,
and gift-card maintenance are production-critical flows in the canonical
application runtime. The current architecture does not gate these flows with
Store rollout feature flags.

The historical/modeling flags `STORE_ENABLED`, `GIFT_CARD_PURCHASE_ENABLED`,
`GIFT_CARD_REDEMPTION_ENABLED`, and `GIFT_CARD_MAINTENANCE_ENABLED` are not
active runtime configuration and must not be treated as production requirements.

`scripts/e2e-verify-config.ts` validates the E2E secret and required Store
Stripe price IDs before Playwright starts. It does not validate Store rollout
feature flags.

### Operational readiness for Store / Gift Card depends on

- Correctly seeded catalog (Products + Prices with `StripeSyncStatus.SYNCED`)
- Store Stripe price IDs (`STRIPE_PRICE_ID_STORE_*`) present in production and E2E environments
- E2E and integration coverage passing
- Webhook validation functioning
- `CRON_SECRET` protecting the maintenance route
- Maintenance scheduling configured only after `npm run verify:gift-card-maintenance` passes
- Audit/reconciliation checks via `GiftCardManualReview`

## Canonical References
- `docs/00_01_system_baseline.md`
- `docs/00_02_deployment_baseline.md`
- `.github/workflows/ci.yml`
- `src/lib/email/resend-delivery.ts`
