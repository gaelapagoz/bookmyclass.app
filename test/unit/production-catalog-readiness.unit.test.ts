import { BillingInterval, PriceType, ProductType, StripeSyncStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  evaluateProductionCatalogReadiness,
  type ProductionCatalogPrice,
} from "@/lib/catalog/production-catalog-readiness";

function syncedPrice(overrides: Partial<ProductionCatalogPrice> = {}): ProductionCatalogPrice {
  return {
    id: "price-1",
    lookupKey: "collective-drop-in-eur-once-v1",
    name: "Drop-in",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 2200,
    billingInterval: null,
    billingIntervalCount: null,
    stripePriceId: "price_test_drop_in",
    stripeSyncStatus: StripeSyncStatus.SYNCED,
    isActive: true,
    isArchived: false,
    product: {
      id: "product-1",
      slug: "collective-drop-in",
      name: "Collective Drop-In",
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
    },
    ...overrides,
  };
}

describe("evaluateProductionCatalogReadiness", () => {
  it("fails on PENDING active checkout price", () => {
    const result = evaluateProductionCatalogReadiness([
      syncedPrice({ stripeSyncStatus: StripeSyncStatus.PENDING }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.blockedCount).toBe(1);
    expect(result.rows[0]?.reasons.join("\n")).toContain("PENDING");
  });

  it("fails on missing stripePriceId", () => {
    const result = evaluateProductionCatalogReadiness([syncedPrice({ stripePriceId: null })]);

    expect(result.ok).toBe(false);
    expect(result.rows[0]?.reasons).toContain("missing stripePriceId");
  });

  it("passes on SYNCED valid one-time price", () => {
    const result = evaluateProductionCatalogReadiness([syncedPrice()]);

    expect(result).toMatchObject({ ok: true, checkedCount: 1, blockedCount: 0 });
    expect(result.rows[0]).toMatchObject({ status: "READY", reasons: [] });
  });

  it("passes on SYNCED recurring membership with interval", () => {
    const result = evaluateProductionCatalogReadiness([
      syncedPrice({
        priceType: PriceType.RECURRING,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        product: {
          id: "product-2",
          slug: "monthly-unlimited",
          name: "Monthly Unlimited",
          productType: ProductType.UNLIMITED_MEMBERSHIP,
          isActive: true,
          isArchived: false,
        },
      }),
    ]);

    expect(result.ok).toBe(true);
  });
});
