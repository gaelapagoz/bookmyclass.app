import { describe, expect, it } from "vitest";

import { verifyE2EConfig } from "../../scripts/e2e-verify-config";

const completeEnv = {
  AUTH_SECRET: "auth-secret",
  E2E_TEST_SECRET: "e2e-secret",
  STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR: "price_test_gift_25",
  STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR: "price_test_gift_50",
  STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR: "price_test_gift_100",
  STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT: "price_test_mat",
  STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS: "price_test_bands",
  STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE: "price_test_tote",
};

describe("verifyE2EConfig", () => {
  it("fails when any required Store E2E env var is missing", () => {
    const result = verifyE2EConfig({
      ...completeEnv,
      STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE: "",
    });

    expect(result.ok).toBe(false);
    expect(result.missing.join("\n")).toContain("STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE");
  });

  it("fails when AUTH_SECRET is missing even if legacy NEXTAUTH_SECRET is present", () => {
    const result = verifyE2EConfig({
      ...completeEnv,
      AUTH_SECRET: "",
      NEXTAUTH_SECRET: "legacy-secret",
    });

    expect(result.ok).toBe(false);
    expect(result.missing.join("\n")).toContain("AUTH_SECRET");
  });

  it("does not require historical Store feature flags", () => {
    const result = verifyE2EConfig({
      ...completeEnv,
      STORE_ENABLED: "0",
      GIFT_CARD_PURCHASE_ENABLED: "",
      GIFT_CARD_REDEMPTION_ENABLED: "false",
    });

    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("passes when all required Store E2E env vars are present", () => {
    const result = verifyE2EConfig(completeEnv);

    expect(result).toEqual({ ok: true, missing: [] });
  });
});
