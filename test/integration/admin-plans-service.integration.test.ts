import "./helpers/setup-env";

import { BillingInterval, EntitlementScope, EntitlementType, PriceType, ProductType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { provisionPlanOnStripeMock, resolveStripeProductIdFromPriceMock } = vi.hoisted(() => ({
  provisionPlanOnStripeMock: vi.fn(),
  resolveStripeProductIdFromPriceMock: vi.fn(),
}));

vi.mock("../../src/lib/admin/plan-provisioning", () => ({
  provisionPlanOnStripe: (...args: unknown[]) => provisionPlanOnStripeMock(...args),
  resolveStripeProductIdFromPrice: (...args: unknown[]) => resolveStripeProductIdFromPriceMock(...args),
}));

import { createAdminPlan, updateAdminPlan } from "../../src/lib/admin/admin-service";
import { getActiveSubscriptionCatalogProducts } from "../../src/lib/subscription/subscription-products";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin plan service", () => {
  beforeEach(async () => {
    provisionPlanOnStripeMock.mockReset();
    resolveStripeProductIdFromPriceMock.mockReset();

    let provisionCall = 0;
    provisionPlanOnStripeMock.mockImplementation(async () => {
      provisionCall += 1;
      return {
        ok: true,
        stripeProductId: "prod_test_1",
        stripePriceId: `price_test_${provisionCall}`,
      };
    });

    await resetDb();
  });

  it("creates product with generated slug, active price, and checkout-ready Stripe mapping", async () => {
    const created = await createAdminPlan({
      name: "Unlimited Monthly",
      description: "Studio membership",
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      sortOrder: 1,
      priceName: "Monthly Membership",
      priceType: PriceType.RECURRING,
      currencyCode: "eur",
      unitAmountMinor: 8900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    });

    const createdWithPrice = await prisma.product.findUnique({
      where: { id: created?.id },
      include: {
        prices: {
          where: { isActive: true, isArchived: false },
        },
      },
    });

    expect(createdWithPrice?.slug).toBe("unlimited-monthly");
    expect(createdWithPrice?.prices).toHaveLength(1);
    expect(createdWithPrice?.prices[0]?.unitAmountMinor).toBe(8900);
    expect(createdWithPrice?.prices[0]?.currencyCode).toBe("EUR");
    expect(createdWithPrice?.prices[0]?.stripePriceId).toBe("price_test_1");

    const activeRule = await prisma.entitlementRule.findFirst({
      where: {
        productId: created?.id,
        isActive: true,
      },
      select: {
        entitlementType: true,
        entitlementScope: true,
        quantity: true,
      },
    });

    expect(activeRule?.entitlementType).toBe(EntitlementType.UNLIMITED_ACCESS);
    expect(activeRule?.entitlementScope).toBe(EntitlementScope.COLLECTIVE_CLASSES);
    expect(activeRule?.quantity).toBeNull();
  });

  it("updates plan with price change and keeps one active current price", async () => {
    const created = await createAdminPlan({
      name: "Starter Pack",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    const updateInput = {
      name: "Starter Pack Plus",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 2,
      priceName: "Starter Plus",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 4900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    };

    resolveStripeProductIdFromPriceMock.mockResolvedValue("prod_test_existing");

    await updateAdminPlan(created?.id ?? "", updateInput);
    await updateAdminPlan(created?.id ?? "", updateInput);

    const product = await prisma.product.findUnique({
      where: { id: created?.id ?? "" },
      include: { prices: true },
    });

    const activePrices = product?.prices.filter((price) => price.isActive && !price.isArchived) ?? [];

    expect(product?.slug).toBe("starter-pack-plus");
    expect(activePrices).toHaveLength(1);
    expect(activePrices[0]?.unitAmountMinor).toBe(4900);
    expect(activePrices[0]?.priceType).toBe(PriceType.RECURRING);
    expect(activePrices[0]?.stripePriceId).toBeTruthy();

    const activeRules = await prisma.entitlementRule.findMany({
      where: {
        productId: created?.id ?? "",
        isActive: true,
      },
      select: {
        entitlementType: true,
        entitlementScope: true,
        quantity: true,
      },
    });

    expect(activeRules).toHaveLength(1);
    expect(activeRules[0]?.entitlementType).toBe(EntitlementType.CREDIT_PACK);
    expect(activeRules[0]?.entitlementScope).toBe(EntitlementScope.COLLECTIVE_CLASSES);
    expect(activeRules[0]?.quantity).toBe(10);
  });

  it("keeps plan non-purchasable when Stripe provisioning fails", async () => {
    provisionPlanOnStripeMock.mockResolvedValue({
      ok: false,
      reason: "stripe unavailable",
    });

    const created = await createAdminPlan({
      name: "Provisioning Failure Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    const activePrice = await prisma.price.findFirst({
      where: {
        productId: created?.id ?? "",
        isActive: true,
        isArchived: false,
      },
      select: {
        stripePriceId: true,
      },
    });

    expect(activePrice?.stripePriceId).toBeNull();

    const catalogProducts = await getActiveSubscriptionCatalogProducts();
    expect(catalogProducts.find((item) => item.productId === created?.id)).toBeUndefined();
  });
});
