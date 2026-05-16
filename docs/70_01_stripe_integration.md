# Stripe Integration

Purpose: document the current Stripe integration boundary and behavior.

## Integration Boundary
- Stripe client wrapper: `src/lib/payments/stripe.ts`.
- Checkout and billing portal session creation are centralized through this module.
- Webhook signature verification is centralized through `verifyStripeWebhookEvent`.

## Main Flows Using Stripe
- Booking paid path checkout session creation.
- Subscription checkout session creation.
- Billing portal session creation for existing Stripe customers.
- Webhook-driven finalization/reconciliation for payment and subscription events.

Checkout source-of-truth contract:
- Runtime checkout for booking/subscription/cart resolves Stripe line-item prices from DB `Price.stripePriceId` by default.
- Cart checkout may use Stripe `price_data` only for the remaining payable balance after an approved gift-card wallet redemption.
- That dynamic cart remainder must be derived server-side from persisted `Product`/`Price` snapshots and the reserved wallet amount.
- Runtime checkout does not read env Stripe price lookup mappings.
- Store checkout-ready read models require `Price.stripePriceId` and `StripeSyncStatus.SYNCED`.
- Gift-card prices must be EUR one-time prices and pass the same Stripe readiness gate before exposure.

## Required Runtime Inputs
- `APP_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (client-side key exposure)

## Catalog Sync Script

`scripts/catalog-server-sync-stripe.ts` (run via `npm run stripe:catalog:sync`) is the
authoritative tool for populating `Price.stripePriceId` from Stripe.

**How it works:**
1. Reads all active, non-archived `Product + Price` records from the local DB.
2. For each price, checks Stripe for an existing Product and Price (by stored ID
   or by `lookup_key`).
3. Verifies that currency, amount, type, and recurrence interval all match.
4. Creates Stripe Products and Prices only when none exist.
5. Writes the confirmed Stripe price ID back to `Price.stripePriceId` and sets
   `StripeSyncStatus.SYNCED` — only after Stripe confirms the price is live.

**Idempotency strategy:**
- Prices already at `StripeSyncStatus.SYNCED` are verified, not re-created.
- Stripe Products are found by `metadata.localProductId` before creation.
- Stripe Prices are found by `lookup_key` before creation.
- Re-running the script produces the same outcome.

**Safety guarantees:**
- Live mode (`sk_live_*`) requires explicit `--confirm-live` flag or the script aborts.
- `--dry-run` mode prints the full plan without mutating Stripe or DB.
- `STRIPE_SECRET_KEY` is never logged.
- Amount/currency/recurrence mismatches are reported as errors — never silently fixed.
  Stripe prices are immutable; changed amounts require a new local Price record.
- `StripeSyncStatus.SYNCED` is never written without a successful Stripe API response.

**Scope flags:**
- `--scope=all` — all products (default)
- `--scope=plans` — class/subscription products only
- `--scope=store` — gift cards and merchandise only

**When to run:**
- After initial DB seed in a new environment (test or production).
- After adding a new Product/Price record that has no Stripe price yet.
- After setting `STRIPE_SECRET_KEY` in an environment that previously had PENDING prices.
- During store feature rollout to make gift cards and merchandise checkout-ready.

See `docs/40_02_environment_variables.md` for full flag reference, required key
permissions, and rollback/verification steps.

## Canonical References
- `src/lib/payments/stripe.ts`
- `scripts/catalog-server-sync-stripe.ts`
- `src/app/api/checkout/session/route.ts`
- `src/app/api/subscription/checkout/route.ts`
- `src/app/api/subscription/portal/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/lib/public-booking/stripe-webhook-service.ts`
