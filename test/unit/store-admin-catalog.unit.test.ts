import { describe, expect, it } from "vitest";

import {
  validateGiftCardAdminPriceInput,
  validateMerchandisePriceInput,
} from "../../src/lib/store/store-admin-catalog-service";
import {
  isCatalogPriceCheckoutReady,
  isStripePriceIdAllowedForRuntime,
} from "../../src/lib/catalog/checkout-readiness";
import { validateGiftCardPriceForCheckoutExposure } from "../../src/lib/store/store-catalog";
import { PriceType, ProductType, StripeSyncStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Merchandise price validation
// ---------------------------------------------------------------------------

describe("validateMerchandisePriceInput", () => {
  it("accepts a valid positive minor amount", () => {
    expect(validateMerchandisePriceInput({ unitAmountMinor: 2200 })).toEqual({ ok: true });
  });

  it("rejects zero amount", () => {
    const result = validateMerchandisePriceInput({ unitAmountMinor: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AMOUNT");
  });

  it("rejects negative amount", () => {
    const result = validateMerchandisePriceInput({ unitAmountMinor: -100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AMOUNT");
  });

  it("rejects non-integer amount", () => {
    const result = validateMerchandisePriceInput({ unitAmountMinor: 22.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AMOUNT");
  });
});

// ---------------------------------------------------------------------------
// Gift-card price validation
// ---------------------------------------------------------------------------

describe("validateGiftCardAdminPriceInput", () => {
  it("accepts 25 EUR (2500 minor)", () => {
    expect(validateGiftCardAdminPriceInput({ unitAmountMinor: 2500 })).toEqual({ ok: true });
  });

  it("accepts exactly 500 EUR (50000 minor)", () => {
    expect(validateGiftCardAdminPriceInput({ unitAmountMinor: 50_000 })).toEqual({ ok: true });
  });

  it("rejects amount > 500 EUR (50001 minor)", () => {
    const result = validateGiftCardAdminPriceInput({ unitAmountMinor: 50_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AMOUNT_EXCEEDS_CAP");
  });

  it("rejects zero amount", () => {
    const result = validateGiftCardAdminPriceInput({ unitAmountMinor: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AMOUNT");
  });

  it("rejects negative amount", () => {
    const result = validateGiftCardAdminPriceInput({ unitAmountMinor: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AMOUNT");
  });

  it("rejects non-integer (fractional cents)", () => {
    const result = validateGiftCardAdminPriceInput({ unitAmountMinor: 2500.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AMOUNT");
  });
});

// ---------------------------------------------------------------------------
// Checkout-readiness: live environment rejects missing stripePriceId
// ---------------------------------------------------------------------------

describe("isCatalogPriceCheckoutReady — live-price validation", () => {
  const basePrice = {
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 2500,
    billingInterval: null,
    billingIntervalCount: null,
    stripeSyncStatus: StripeSyncStatus.SYNCED,
  };

  it("rejects missing stripePriceId", () => {
    expect(
      isCatalogPriceCheckoutReady({ ...basePrice, stripePriceId: null }),
    ).toBe(false);
  });

  it("rejects when stripeSyncStatus is PENDING", () => {
    expect(
      isCatalogPriceCheckoutReady({
        ...basePrice,
        stripePriceId: "price_test_abc",
        stripeSyncStatus: StripeSyncStatus.PENDING,
      }),
    ).toBe(false);
  });

  it("rejects when stripeSyncStatus is FAILED", () => {
    expect(
      isCatalogPriceCheckoutReady({
        ...basePrice,
        stripePriceId: "price_test_abc",
        stripeSyncStatus: StripeSyncStatus.FAILED,
      }),
    ).toBe(false);
  });

  it("rejects test stripe ID in live mode", () => {
    expect(
      isStripePriceIdAllowedForRuntime("price_test_abc123", "live"),
    ).toBe(false);
  });

  it("accepts live stripe ID in live mode", () => {
    expect(
      isStripePriceIdAllowedForRuntime("price_live_abc123", "live"),
    ).toBe(true);
  });

  it("rejects live stripe ID in test mode", () => {
    expect(
      isStripePriceIdAllowedForRuntime("price_live_abc123", "test"),
    ).toBe(false);
  });

  it("accepts test stripe ID in test mode", () => {
    expect(
      isStripePriceIdAllowedForRuntime("price_test_abc123", "test"),
    ).toBe(true);
  });

  it("accepts a valid synced EUR one-time price in test mode", () => {
    expect(
      isCatalogPriceCheckoutReady(
        {
          ...basePrice,
          stripePriceId: "price_test_abc",
          stripeSyncStatus: StripeSyncStatus.SYNCED,
        },
        { stripeRuntimeMode: "test" },
      ),
    ).toBe(true);
  });

  it("rejects a recurring price (gift-card must be one-time)", () => {
    expect(
      isCatalogPriceCheckoutReady({
        ...basePrice,
        stripePriceId: "price_test_abc",
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        priceType: PriceType.RECURRING,
        billingInterval: null,
        billingIntervalCount: null,
      }),
    ).toBe(false);
  });

  it("rejects non-EUR currency via gift-card exposure validation", () => {
    const result = validateGiftCardPriceForCheckoutExposure({
      productType: ProductType.GIFT_CARD,
      priceType: PriceType.ONE_TIME,
      currencyCode: "USD",
      unitAmountMinor: 2500,
      billingInterval: null,
      billingIntervalCount: null,
      isActive: true,
      isArchived: false,
      stripePriceId: "price_test_abc",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CURRENCY");
  });

  it("rejects amount <= 0", () => {
    expect(
      isCatalogPriceCheckoutReady({
        ...basePrice,
        stripePriceId: "price_test_abc",
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        unitAmountMinor: 0,
      }),
    ).toBe(false);
  });
});

