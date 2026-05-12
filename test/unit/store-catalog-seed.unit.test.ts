import { PriceType, ProductType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  STORE_CATALOG_PRODUCT_COUNT,
  STORE_CATALOG_PRODUCTS,
  STORE_GIFT_CARD_DENOMINATIONS_MINOR,
  STORE_GIFT_CARD_PRODUCTS,
  STORE_MERCHANDISE_PRODUCTS,
} from "../../prisma/seed/data/store-catalog";

describe("Store catalog seed data — gift cards", () => {
  it("has exactly 3 gift card products", () => {
    expect(STORE_GIFT_CARD_PRODUCTS).toHaveLength(3);
  });

  it("gift card denominations are €25, €50, €100 (EUR minor)", () => {
    expect(STORE_GIFT_CARD_DENOMINATIONS_MINOR).toEqual([2500, 5000, 10000]);
  });

  it("each gift card price matches a denomination", () => {
    const priceAmounts = STORE_GIFT_CARD_PRODUCTS.map((p) => p.price.unitAmountMinor).sort((a, b) => a - b);
    expect(priceAmounts).toEqual([2500, 5000, 10000]);
  });

  it("all gift cards use productType GIFT_CARD", () => {
    for (const product of STORE_GIFT_CARD_PRODUCTS) {
      expect(product.productType).toBe(ProductType.GIFT_CARD);
    }
  });

  it("all gift card prices are ONE_TIME and EUR", () => {
    for (const product of STORE_GIFT_CARD_PRODUCTS) {
      expect(product.price.priceType).toBe(PriceType.ONE_TIME);
      expect(product.price.currencyCode).toBe("EUR");
    }
  });
});

describe("Store catalog seed data — merchandise", () => {
  it("has at least 3 merchandise products", () => {
    expect(STORE_MERCHANDISE_PRODUCTS.length).toBeGreaterThanOrEqual(3);
  });

  it("all merchandise uses productType MERCHANDISE", () => {
    for (const product of STORE_MERCHANDISE_PRODUCTS) {
      expect(product.productType).toBe(ProductType.MERCHANDISE);
    }
  });

  it("all merchandise prices are ONE_TIME and EUR", () => {
    for (const product of STORE_MERCHANDISE_PRODUCTS) {
      expect(product.price.priceType).toBe(PriceType.ONE_TIME);
      expect(product.price.currencyCode).toBe("EUR");
    }
  });

  it("all merchandise descriptions contain pickup-only wording", () => {
    for (const product of STORE_MERCHANDISE_PRODUCTS) {
      expect(product.description.toLowerCase()).toMatch(/pickup/);
    }
  });
});

describe("Store catalog seed data — combined catalog", () => {
  it("STORE_CATALOG_PRODUCT_COUNT equals total combined products", () => {
    expect(STORE_CATALOG_PRODUCT_COUNT).toBe(STORE_CATALOG_PRODUCTS.length);
    expect(STORE_CATALOG_PRODUCT_COUNT).toBe(
      STORE_GIFT_CARD_PRODUCTS.length + STORE_MERCHANDISE_PRODUCTS.length,
    );
  });

  it("all product slugs are unique", () => {
    const slugs = STORE_CATALOG_PRODUCTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("all price lookup keys are unique", () => {
    const keys = STORE_CATALOG_PRODUCTS.map((p) => p.price.lookupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("all seeded store prices declare Stripe price env mappings", () => {
    const envVarNames = STORE_CATALOG_PRODUCTS.map((p) => p.price.stripePriceEnvVarName);

    expect(new Set(envVarNames).size).toBe(envVarNames.length);
    for (const envVarName of envVarNames) {
      expect(envVarName).toMatch(/^STRIPE_PRICE_ID_STORE_/);
    }
  });

  it("all sort orders are unique and ascending by product group", () => {
    const sortOrders = STORE_CATALOG_PRODUCTS.map((p) => p.sortOrder);
    expect(new Set(sortOrders).size).toBe(sortOrders.length);
    const giftCardOrders = STORE_GIFT_CARD_PRODUCTS.map((p) => p.sortOrder);
    const merchOrders = STORE_MERCHANDISE_PRODUCTS.map((p) => p.sortOrder);
    expect(Math.max(...giftCardOrders)).toBeLessThan(Math.min(...merchOrders));
  });

  it("no entitlement rules are defined on any store product", () => {
    for (const product of STORE_CATALOG_PRODUCTS) {
      expect(Object.keys(product)).not.toContain("entitlementRules");
    }
  });

  it("all lookup keys follow the expected slug pattern", () => {
    const lookupKeyPattern = /^[a-z0-9]+(-[a-z0-9]+)*-eur-once-v\d+$/;
    for (const product of STORE_CATALOG_PRODUCTS) {
      expect(product.price.lookupKey).toMatch(lookupKeyPattern);
    }
  });

  it("all product slugs start with store-", () => {
    for (const product of STORE_CATALOG_PRODUCTS) {
      expect(product.slug).toMatch(/^store-/);
    }
  });
});
