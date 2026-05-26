import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  getStripeServerEnv,
} from "@/lib/payments/stripe";
import type Stripe from "stripe";

// Compatibility facade: keep callers on this boundary while Stripe client/runtime
// behavior remains centralized in src/lib/payments/stripe.ts.
export async function createSubscriptionCheckoutSession(input: {
  cancelUrl: string;
  checkoutMode: Stripe.Checkout.SessionCreateParams.Mode;
  priceId: string;
  productId: string;
  stripePriceId: string;
  successUrl: string;
  userId: string;
}) {
  const metadata = {
    productId: input.productId,
    priceId: input.priceId,
    userId: input.userId,
  };

  return createStripeCheckoutSession({
    mode: input.checkoutMode,
    line_items: [
      {
        price: input.stripePriceId,
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
    subscription_data:
      input.checkoutMode === "subscription"
        ? {
            metadata,
          }
        : undefined,
    client_reference_id: input.userId,
  });
}

export function getAppUrlFromStripeEnv(): string {
  return getStripeServerEnv().appUrl;
}

export async function createSubscriptionBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}) {
  return createStripeBillingPortalSession({
    customer: input.customerId,
    returnUrl: input.returnUrl,
  });
}
