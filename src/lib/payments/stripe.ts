import Stripe from "stripe";

type StripeServerEnv = {
  appUrl: string;
  secretKey: string;
  webhookSecret?: string;
};

type StripePublicEnv = {
  publishableKey: string;
};

function assertEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function getStripeServerEnv(): StripeServerEnv {
  return {
    appUrl: assertEnv("appUrl", process.env.APP_URL),
    secretKey: assertEnv("secretKey", process.env.STRIPE_SECRET_KEY),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  };
}

export function getStripePublicEnv(): StripePublicEnv {
  return {
    publishableKey: assertEnv("publishableKey", process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  };
}

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  const env = getStripeServerEnv();

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

export async function createStripeCheckoutSessionWithIdempotency(input: {
  params: Stripe.Checkout.SessionCreateParams;
  idempotencyKey: string;
}): Promise<Stripe.Checkout.Session> {
  return getStripeClient().checkout.sessions.create(input.params, {
    idempotencyKey: input.idempotencyKey,
  });
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
  const webhookSecret = assertEnv("webhookSecret", getStripeServerEnv().webhookSecret);
  return getStripeClient().webhooks.constructEvent(
    params.payload,
    params.signature,
    webhookSecret,
  );
}
