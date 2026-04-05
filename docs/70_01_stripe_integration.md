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

## Required Runtime Inputs
- `APP_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (client-side key exposure)

## Canonical References
- `src/lib/payments/stripe.ts`
- `src/app/api/checkout/session/route.ts`
- `src/app/api/subscription/checkout/route.ts`
- `src/app/api/subscription/portal/route.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/lib/public-booking/stripe-webhook-service.ts`
