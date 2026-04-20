import { describe, expect, it } from "vitest";
import { PriceType, ProductType, SubscriptionStatus } from "@prisma/client";
import { createCartValidationService } from "../../src/lib/cart/cart-service";

function buildCatalogPrice(overrides?: Partial<{
  priceId: string;
  productId: string;
  productName: string;
  productDescription: string | null;
  productType: ProductType;
  priceName: string;
  priceType: PriceType;
  unitAmountMinor: number;
  currencyCode: string;
  billingInterval: null;
  billingIntervalCount: null;
  checkoutEnabled: boolean;
  productIsActive: boolean;
  productIsArchived: boolean;
  priceIsActive: boolean;
  priceIsArchived: boolean;
  priceStartsAt: Date | null;
  priceEndsAt: Date | null;
}>) {
  return {
    priceId: "price_1",
    productId: "prod_1",
    productName: "Plan A",
    productDescription: null,
    productType: ProductType.UNLIMITED_MEMBERSHIP,
    priceName: "Plan A Monthly",
    priceType: PriceType.RECURRING,
    unitAmountMinor: 7900,
    currencyCode: "EUR",
    billingInterval: null,
    billingIntervalCount: null,
    checkoutEnabled: true,
    productIsActive: true,
    productIsArchived: false,
    priceIsActive: true,
    priceIsArchived: false,
    priceStartsAt: null,
    priceEndsAt: null,
    ...overrides,
  };
}

describe("cart validation service", () => {
  it("rejects recurring quantity above 1", async () => {
    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [buildCatalogPrice()],
      getClientSubscriptionSnapshots: async () => [],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [{ productId: "prod_1", priceId: "price_1", quantity: 2 }],
      clientId: "client_1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.rejection.code).toBe("RECURRING_QUANTITY_MUST_BE_ONE");
    expect(result.rejection.message).toBe("Recurring products must have a quantity of 1.");
  });

  it("rejects mixed recurring and one-time composition", async () => {
    const recurring = buildCatalogPrice({
      priceId: "price_rec",
      productId: "prod_rec",
      priceType: PriceType.RECURRING,
    });
    const oneTime = buildCatalogPrice({
      priceId: "price_one",
      productId: "prod_one",
      priceType: PriceType.ONE_TIME,
      productName: "Drop In",
      priceName: "Drop In Price",
      unitAmountMinor: 2500,
    });

    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [recurring, oneTime],
      getClientSubscriptionSnapshots: async () => [],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [
        { productId: "prod_rec", priceId: "price_rec", quantity: 1 },
        { productId: "prod_one", priceId: "price_one", quantity: 1 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.rejection.code).toBe("MIXED_PRICE_TYPES_NOT_ALLOWED");
    expect(result.rejection.message).toBe("You cannot mix recurring and one-time products in the same checkout.");
  });

  it("normalizes duplicate lines and computes authoritative subtotal", async () => {
    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [
        buildCatalogPrice({
          priceId: "price_one",
          productId: "prod_one",
          priceType: PriceType.ONE_TIME,
          unitAmountMinor: 1500,
        }),
      ],
      getClientSubscriptionSnapshots: async () => [],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [
        { productId: "prod_one", priceId: "price_one", quantity: 1 },
        { productId: "prod_one", priceId: "price_one", quantity: 2 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.normalizedLines).toEqual([{ productId: "prod_one", priceId: "price_one", quantity: 3 }]);
    expect(result.repricedLines[0]?.lineSubtotalAmountMinor).toBe(4500);
    expect(result.pricing.subtotalAmountMinor).toBe(4500);
  });

  it("rejects inactive product", async () => {
    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [buildCatalogPrice({ productIsActive: false })],
      getClientSubscriptionSnapshots: async () => [],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [{ productId: "prod_1", priceId: "price_1", quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.rejection.code).toBe("PRODUCT_NOT_ACTIVE");
    expect(result.rejection.message).toBe("One or more products in your cart are no longer available.");
  });

  it("rejects inactive or stale price", async () => {
    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [
        buildCatalogPrice({
          priceIsActive: true,
          priceEndsAt: new Date("2026-04-18T10:00:00.000Z"),
        }),
      ],
      getClientSubscriptionSnapshots: async () => [],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [{ productId: "prod_1", priceId: "price_1", quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.rejection.code).toBe("PRICE_NOT_ACTIVE");
    expect(result.rejection.message).toBe("One or more prices in your cart are no longer available.");
  });

  it("rejects checkout-disabled price", async () => {
    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [buildCatalogPrice({ checkoutEnabled: false })],
      getClientSubscriptionSnapshots: async () => [],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [{ productId: "prod_1", priceId: "price_1", quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.rejection.code).toBe("CHECKOUT_NOT_ENABLED");
    expect(result.rejection.message).toBe("One or more cart items are not checkout-ready.");
  });

  it("enforces max one active subscription total using shared predicate behavior", async () => {
    const service = createCartValidationService({
      getCatalogPricesByIds: async () => [
        buildCatalogPrice({
          priceId: "price_rec",
          productId: "prod_rec",
          priceType: PriceType.RECURRING,
        }),
      ],
      getClientSubscriptionSnapshots: async () => [
        {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: null,
        },
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: null,
        },
      ],
      now: () => new Date("2026-04-19T10:00:00.000Z"),
    });

    const result = await service.validate({
      lines: [{ productId: "prod_rec", priceId: "price_rec", quantity: 1 }],
      clientId: "client_1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.rejection.code).toBe("ACTIVE_SUBSCRIPTION_ALREADY_EXISTS");
    expect(result.rejection.message).toBe("You already have an active subscription.");
  });
});
