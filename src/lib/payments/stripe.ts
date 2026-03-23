import Stripe from "stripe";

type RequiredStripeEnv = {
  appUrl: string;
  publishableKey: string;
  secretKey: string;
};

function assertEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function getStripeEnv(): RequiredStripeEnv {
  return {
    appUrl: assertEnv("appUrl", process.env.APP_URL),
    publishableKey: assertEnv("publishableKey", process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    secretKey: assertEnv("secretKey", process.env.STRIPE_SECRET_KEY),
  };
}

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  const env = getStripeEnv();

  if (!stripeClient) {
    stripeClient = new Stripe(env.secretKey, {
      apiVersion: "2025-08-27.basil",
    });
  }

  return stripeClient;
}

export async function createStripeCheckoutSession(
  input: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session> {
  return getStripeClient().checkout.sessions.create(input);
}

export async function createStripeBillingPortalSession(input: {
  customer: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  return getStripeClient().billingPortal.sessions.create({
    customer: input.customer,
    return_url: input.returnUrl,
  });
}

export function verifyStripeWebhookEvent(params: {
  payload: string;
  signature: string;
}): Stripe.Event {
  const webhookSecret = assertEnv("webhookSecret", process.env.STRIPE_WEBHOOK_SECRET);
  return getStripeClient().webhooks.constructEvent(
    params.payload,
    params.signature,
    webhookSecret,
  );
}
