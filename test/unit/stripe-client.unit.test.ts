import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("getStripeClient", () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("does not require unrelated runtime env vars to initialize Stripe client", async () => {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://demo.bookmyclass.app";
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout_only";
    delete process.env.MARKETING_TRACKING_SECRET;
    delete process.env.CRON_SECRET;

    const { getStripeClient } = await import("../../src/lib/payments/stripe");

    expect(() => getStripeClient()).not.toThrow();
    expect(getStripeClient()).toBe(getStripeClient());
  });

  it("returns stable keyed clients and isolates different keys", async () => {
    const { getStripeClientForSecretKey } = await import("../../src/lib/payments/stripe");

    const testA1 = getStripeClientForSecretKey("sk_test_key_a");
    const testA2 = getStripeClientForSecretKey("sk_test_key_a");
    const testB = getStripeClientForSecretKey("sk_test_key_b");

    expect(testA1).toBe(testA2);
    expect(testA1).not.toBe(testB);
  });
});
