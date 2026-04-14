import { afterEach, describe, expect, it } from "vitest";

import { getStripePublicEnv, getStripeServerEnv, verifyStripeWebhookEvent } from "../../src/lib/payments/stripe";

describe("stripe env and webhook guards", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalPublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
    process.env.STRIPE_SECRET_KEY = originalSecretKey;
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalPublishableKey;
  });

  it("returns server env when required values exist", () => {
    process.env.APP_URL = "http://localhost:3000";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";

    expect(getStripeServerEnv()).toEqual({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
  });

  it("throws when required server env var is missing", () => {
    process.env.APP_URL = "";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";

    expect(() => getStripeServerEnv()).toThrow("Missing required env var: appUrl");
  });

  it("throws when public publishable key is missing", () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "";
    expect(() => getStripePublicEnv()).toThrow("Missing required env var: publishableKey");
  });

  it("throws when webhook secret is missing for webhook verification", () => {
    process.env.APP_URL = "http://localhost:3000";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "";

    expect(() =>
      verifyStripeWebhookEvent({
        payload: "{}",
        signature: "invalid",
      }),
    ).toThrow("Missing required env var: webhookSecret");
  });
});
