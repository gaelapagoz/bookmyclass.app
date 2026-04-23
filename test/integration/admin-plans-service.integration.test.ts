import "./helpers/setup-env";

import {
  BillingInterval,
  EntitlementScope,
  EntitlementType,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { provisionPlanOnStripeMock, resolveStripeProductIdFromPriceMock, stripeClientMock } = vi.hoisted(() => ({
  provisionPlanOnStripeMock: vi.fn(),
  resolveStripeProductIdFromPriceMock: vi.fn(),
  stripeClientMock: {
    products: {
      create: vi.fn(),
      update: vi.fn(),
    },
    prices: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/payments/stripe", () => ({
  getStripeClient: () => stripeClientMock,
}));

vi.mock("../../src/lib/admin/plan-provisioning", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/admin/plan-provisioning")>(
    "../../src/lib/admin/plan-provisioning",
  );

  return {
    ...actual,
    provisionPlanOnStripe: (...args: unknown[]) => provisionPlanOnStripeMock(...args),
    resolveStripeProductIdFromPrice: (...args: unknown[]) => resolveStripeProductIdFromPriceMock(...args),
  };
});

import {
  applyStripeProvisionResultToPrice,
  createAdminPlan,
  getAdminPlanById,
  getAdminPlansData,
  remediatePriceStripeId,
  updateAdminPlan,
} from "../../src/lib/admin/admin-service";
import { buildStripeIdempotencyKey } from "../../src/lib/admin/plan-provisioning";
import { getActiveSubscriptionCatalogProducts } from "../../src/lib/subscription/subscription-products";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin plan service", () => {
  let adminActor: { actorId: string; actorRole: Role };

  async function createPlan(
    input: Parameters<typeof createAdminPlan>[0] extends { actor: unknown } ? Omit<Parameters<typeof createAdminPlan>[0], "actor"> : never,
  ) {
    return createAdminPlan({
      ...input,
      actor: adminActor,
    });
  }

  async function updatePlan(
    id: string,
    input: Parameters<typeof updateAdminPlan>[1] extends { actor: unknown } ? Omit<Parameters<typeof updateAdminPlan>[1], "actor"> : never,
  ) {
    return updateAdminPlan(id, {
      ...input,
      actor: adminActor,
    });
  }

  beforeEach(async () => {
    provisionPlanOnStripeMock.mockReset();
    resolveStripeProductIdFromPriceMock.mockReset();
    stripeClientMock.products.create.mockReset();
    stripeClientMock.products.update.mockReset();
    stripeClientMock.prices.create.mockReset();

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
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        email: `admin.plan.${Date.now()}@example.test`,
        role: Role.ADMIN,
        emailVerified: new Date(),
      },
      select: {
        id: true,
        role: true,
      },
    });
    adminActor = {
      actorId: admin.id,
      actorRole: admin.role,
    };
  });

  it("creates product with generated slug, active price, and checkout-ready Stripe mapping", async () => {
    const created = await createPlan({
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
    expect(createdWithPrice?.prices[0]?.stripeSyncStatus).toBe(StripeSyncStatus.SYNCED);
    expect(createdWithPrice?.prices[0]?.stripeSyncCorrelation).toMatch(/^admin-create-/);
    expect(createdWithPrice?.prices[0]?.stripeSyncLastSuccess).not.toBeNull();
    const createCallCorrelation = (provisionPlanOnStripeMock.mock.calls[0]?.[0] as { syncCorrelation?: string } | undefined)
      ?.syncCorrelation;
    expect(createCallCorrelation).toBeTruthy();
    expect(createdWithPrice?.prices[0]?.stripeSyncCorrelation).toBe(createCallCorrelation);

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

  it("rejects one-time prices with billing interval fields", async () => {
    await expect(
      createPlan({
        name: "Invalid One-Time Plan",
        productType: ProductType.CLASS_PACK,
        isActive: true,
        sortOrder: 1,
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 3900,
        billingInterval: BillingInterval.MONTH,
      }),
    ).rejects.toThrow("ONE_TIME_INTERVAL_FORBIDDEN");
  });

  it("rejects recurring prices without billing interval", async () => {
    await expect(
      createPlan({
        name: "Invalid Recurring Plan",
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        sortOrder: 1,
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 4900,
      }),
    ).rejects.toThrow("RECURRING_INTERVAL_REQUIRED");
  });

  it("rejects invalid currency code and invalid amount", async () => {
    await expect(
      createPlan({
        name: "Invalid Currency",
        productType: ProductType.CLASS_PACK,
        isActive: true,
        sortOrder: 1,
        priceType: PriceType.ONE_TIME,
        currencyCode: "EURO",
        unitAmountMinor: 3900,
      }),
    ).rejects.toThrow("INVALID_CURRENCY_CODE");

    await expect(
      createPlan({
        name: "Invalid Amount",
        productType: ProductType.CLASS_PACK,
        isActive: true,
        sortOrder: 1,
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 0,
      }),
    ).rejects.toThrow("INVALID_UNIT_AMOUNT");
  });

  it("rejects recurring prices with invalid billing interval count", async () => {
    await expect(
      createPlan({
        name: "Invalid Interval Count",
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        sortOrder: 1,
        priceType: PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 4900,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 0,
      }),
    ).rejects.toThrow("INVALID_BILLING_INTERVAL_COUNT");
  });

  it("updates plan with price change and keeps one active current price", async () => {
    const created = await createPlan({
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

    await updatePlan(created?.id ?? "", updateInput);
    const updatedSecond = await updatePlan(created?.id ?? "", updateInput);

    const product = await prisma.product.findUnique({
      where: { id: created?.id ?? "" },
      include: { prices: true },
    });

    const activePrices = product?.prices.filter((price) => price.isActive && !price.isArchived) ?? [];

    expect(product?.slug).toBe("starter-pack-plus");
    expect(activePrices).toHaveLength(1);
    expect(product?.prices).toHaveLength(2);
    expect(activePrices[0]?.unitAmountMinor).toBe(4900);
    expect(activePrices[0]?.priceType).toBe(PriceType.RECURRING);
    expect(activePrices[0]?.stripePriceId).toBeTruthy();
    expect(updatedSecond?.id).toBe(created?.id);
    expect(provisionPlanOnStripeMock).toHaveBeenCalledTimes(2);

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

  it("retries identical failed update without creating duplicate price versions", async () => {
    const created = await createPlan({
      name: "Retryable Failure Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    resolveStripeProductIdFromPriceMock.mockResolvedValue("prod_test_existing");

    let updateProvisionCall = 0;
    provisionPlanOnStripeMock.mockImplementation(async () => {
      updateProvisionCall += 1;
      if (updateProvisionCall === 1) {
        return {
          ok: false,
          reason: "temporary Stripe failure",
          stripeErrorCode: "api_connection_error",
        };
      }

      return {
        ok: true,
        stripeProductId: "prod_test_existing",
        stripePriceId: "price_retry_success",
      };
    });

    const updateInput = {
      name: "Retryable Failure Plan Updated",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 2,
      priceName: "Retryable Failure Plan Updated Price",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 4900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    };

    await updatePlan(created?.id ?? "", updateInput);

    const failedActivePrice = await prisma.price.findFirst({
      where: {
        productId: created?.id ?? "",
        isActive: true,
        isArchived: false,
      },
      select: {
        id: true,
        stripeSyncStatus: true,
        stripeSyncErrorCode: true,
        stripeSyncError: true,
        stripeSyncCorrelation: true,
        stripeSyncLastAttempt: true,
      },
    });

    expect(failedActivePrice?.stripeSyncStatus).toBe(StripeSyncStatus.FAILED);
    expect(failedActivePrice?.stripeSyncErrorCode).toBe("api_connection_error");
    expect(failedActivePrice?.stripeSyncError).toContain("temporary Stripe failure");
    const failedLastAttempt = failedActivePrice?.stripeSyncLastAttempt?.getTime() ?? 0;

    await updatePlan(created?.id ?? "", updateInput);

    const prices = await prisma.price.findMany({
      where: { productId: created?.id ?? "" },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        isActive: true,
        isArchived: true,
        stripePriceId: true,
        stripeSyncStatus: true,
        stripeSyncErrorCode: true,
        stripeSyncError: true,
        stripeSyncCorrelation: true,
        stripeSyncLastAttempt: true,
      },
    });

    const activePrices = prices.filter((price) => price.isActive && !price.isArchived);
    expect(prices).toHaveLength(2);
    expect(activePrices).toHaveLength(1);
    expect(activePrices[0]?.id).toBe(failedActivePrice?.id);
    expect(activePrices[0]?.stripePriceId).toBe("price_retry_success");
    expect(activePrices[0]?.stripeSyncStatus).toBe(StripeSyncStatus.SYNCED);
    expect(activePrices[0]?.stripeSyncErrorCode).toBeNull();
    expect(activePrices[0]?.stripeSyncError).toBeNull();
    expect(activePrices[0]?.stripeSyncCorrelation).not.toBeNull();
    expect((activePrices[0]?.stripeSyncLastAttempt?.getTime() ?? 0)).toBeGreaterThanOrEqual(failedLastAttempt);
    expect(activePrices[0]?.stripeSyncCorrelation).toBe(
      (provisionPlanOnStripeMock.mock.calls.at(-1)?.[0] as { syncCorrelation?: string } | undefined)
        ?.syncCorrelation ?? null,
    );
    expect(updateProvisionCall).toBe(2);
  });

  it("retries identical pending update without creating duplicate price versions", async () => {
    const created = await createPlan({
      name: "Retryable Pending Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    resolveStripeProductIdFromPriceMock.mockResolvedValue("prod_test_existing");

    provisionPlanOnStripeMock.mockResolvedValueOnce({
      ok: false,
      reason: "temporary Stripe failure",
      stripeErrorCode: "api_connection_error",
    });
    provisionPlanOnStripeMock.mockResolvedValueOnce({
      ok: true,
      stripeProductId: "prod_test_existing",
      stripePriceId: "price_pending_retry_success",
    });

    const updateInput = {
      name: "Retryable Pending Plan Updated",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 2,
      priceName: "Retryable Pending Plan Updated Price",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 4900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    };

    await updatePlan(created?.id ?? "", updateInput);

    const failedActivePrice = await prisma.price.findFirst({
      where: {
        productId: created?.id ?? "",
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    const staleAttempt = new Date("2024-01-01T00:00:00.000Z");
    await prisma.price.update({
      where: { id: failedActivePrice?.id ?? "" },
      data: {
        stripeSyncStatus: StripeSyncStatus.PENDING,
        stripeSyncLastAttempt: staleAttempt,
        stripeSyncCorrelation: "stale-correlation",
        stripeSyncErrorCode: "stale-error",
        stripeSyncError: "stale-message",
      },
    });

    await updatePlan(created?.id ?? "", updateInput);

    const prices = await prisma.price.findMany({
      where: { productId: created?.id ?? "" },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        isActive: true,
        isArchived: true,
        stripePriceId: true,
        stripeSyncStatus: true,
        stripeSyncErrorCode: true,
        stripeSyncError: true,
        stripeSyncCorrelation: true,
        stripeSyncLastAttempt: true,
      },
    });

    const activePrices = prices.filter((price) => price.isActive && !price.isArchived);
    expect(prices).toHaveLength(2);
    expect(activePrices).toHaveLength(1);
    expect(activePrices[0]?.id).toBe(failedActivePrice?.id);
    expect(activePrices[0]?.stripePriceId).toBe("price_pending_retry_success");
    expect(activePrices[0]?.stripeSyncStatus).toBe(StripeSyncStatus.SYNCED);
    expect(activePrices[0]?.stripeSyncErrorCode).toBeNull();
    expect(activePrices[0]?.stripeSyncError).toBeNull();
    expect(activePrices[0]?.stripeSyncCorrelation).not.toBe("stale-correlation");
    expect((activePrices[0]?.stripeSyncLastAttempt?.getTime() ?? 0)).toBeGreaterThan(staleAttempt.getTime());
    expect(activePrices[0]?.stripeSyncCorrelation).toBe(
      (provisionPlanOnStripeMock.mock.calls.at(-1)?.[0] as { syncCorrelation?: string } | undefined)
        ?.syncCorrelation ?? null,
    );
  });

  it("throws when provision result conflicts with immutable stripe price id", async () => {
    const created = await createPlan({
      name: "Immutable Guard Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceName: "Immutable Guard Plan Price",
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
      select: { id: true },
    });

    await expect(
      applyStripeProvisionResultToPrice({
        priceId: activePrice?.id ?? "",
        productId: created?.id ?? "",
        actorId: adminActor.actorId,
        syncCorrelation: "admin-update-immutable-check",
        provisionResult: {
          ok: true,
          stripeProductId: "prod_test_immutable",
          stripePriceId: "price_conflicting_new",
        },
      }),
    ).rejects.toThrow("STRIPE_PRICE_ID_IMMUTABLE");
  });

  it("enforces admin role scope for catalog mutations", async () => {
    const nonAdmin = await prisma.user.create({
      data: {
        name: "Client actor",
        email: `client.actor.${Date.now()}@example.test`,
        role: Role.CLIENT,
        emailVerified: new Date(),
      },
      select: {
        id: true,
        role: true,
      },
    });

    await expect(
      createAdminPlan({
        actor: {
          actorId: nonAdmin.id,
          actorRole: nonAdmin.role,
        },
        name: "Forbidden Plan",
        productType: ProductType.CLASS_PACK,
        isActive: true,
        sortOrder: 1,
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 3900,
      }),
    ).rejects.toThrow("ADMIN_ROLE_REQUIRED");
  });

  it("keeps plan non-purchasable when Stripe provisioning fails", async () => {
    provisionPlanOnStripeMock.mockResolvedValue({
      ok: false,
      reason: "stripe unavailable",
      stripeErrorCode: "rate_limit",
    });

    const created = await createPlan({
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
        stripeSyncStatus: true,
        stripeSyncErrorCode: true,
        stripeSyncError: true,
      },
    });

    expect(activePrice?.stripePriceId).toBeNull();
    expect(activePrice?.stripeSyncStatus).toBe(StripeSyncStatus.FAILED);
    expect(activePrice?.stripeSyncErrorCode).toBe("rate_limit");
    expect(activePrice?.stripeSyncError).toContain("stripe unavailable");

    const catalogProducts = await getActiveSubscriptionCatalogProducts();
    expect(catalogProducts.find((item) => item.productId === created?.id)).toBeUndefined();
  });

  it("marks admin list checkout readiness false when stripe sync status is not SYNCED", async () => {
    const created = await createPlan({
      name: "Sync Status Gate Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    const activePrice = await prisma.price.findFirst({
      where: { productId: created?.id ?? "", isActive: true, isArchived: false },
      select: { id: true },
    });

    await prisma.price.update({
      where: { id: activePrice?.id ?? "" },
      data: {
        stripeSyncStatus: StripeSyncStatus.FAILED,
      },
    });

    const list = await getAdminPlansData();
    const item = list.find((entry) => entry.id === created?.id);
    expect(item?.isCheckoutReady).toBe(false);

    const detail = await getAdminPlanById(created?.id ?? "");
    expect(detail?.isCheckoutReady).toBe(false);
  });

  it("marks admin list checkout readiness false when one-time price has interval fields", async () => {
    const product = await prisma.product.create({
      data: {
        name: "Invariant Gate Plan",
        slug: `invariant-gate-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Price" DROP CONSTRAINT IF EXISTS "Price_billing_shape_chk"`,
    );

    try {
      await prisma.price.create({
        data: {
          productId: product.id,
          lookupKey: `invariant-gate-price-${Date.now()}`,
          name: "Invariant Gate Price",
          priceType: PriceType.ONE_TIME,
          currencyCode: "EUR",
          unitAmountMinor: 3900,
          stripePriceId: `price_invariant_gate_${Date.now()}`,
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          billingInterval: BillingInterval.MONTH,
          billingIntervalCount: 1,
          isActive: true,
          isArchived: false,
        },
      });

      const list = await getAdminPlansData();
      const item = list.find((entry) => entry.id === product.id);
      expect(item?.isCheckoutReady).toBe(false);

      const detail = await getAdminPlanById(product.id);
      expect(detail?.isCheckoutReady).toBe(false);
    } finally {
      await prisma.price.deleteMany({
        where: {
          productId: product.id,
          lookupKey: {
            startsWith: "invariant-gate-price-",
          },
        },
      });

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Price" ADD CONSTRAINT "Price_billing_shape_chk" CHECK (
          (
            "priceType" = 'RECURRING'
            AND "billingInterval" IS NOT NULL
            AND COALESCE("billingIntervalCount", 0) > 0
          )
          OR (
            "priceType" = 'ONE_TIME'
            AND "billingInterval" IS NULL
            AND "billingIntervalCount" IS NULL
          )
        )`,
      );
    }
  });

  it("writes catalog audit logs for create, update, activate/deactivate, stripe link, and sync failure", async () => {
    const created = await createPlan({
      name: "Audit Matrix Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    provisionPlanOnStripeMock.mockResolvedValueOnce({
      ok: false,
      reason: "rate limited",
      stripeErrorCode: "rate_limit",
    });

    await updatePlan(created?.id ?? "", {
      name: "Audit Matrix Plan",
      productType: ProductType.CLASS_PACK,
      isActive: false,
      sortOrder: 2,
      priceName: "Audit Matrix Plan Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    await updatePlan(created?.id ?? "", {
      name: "Audit Matrix Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 3,
      priceName: "Audit Matrix Plan Price V2",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    const actions = await prisma.auditLog.findMany({
      where: {
        actorId: adminActor.actorId,
      },
      select: {
        actionType: true,
      },
    });

    const actionTypes = actions.map((entry) => entry.actionType);
    expect(actionTypes).toContain("CATALOG_PRODUCT_CREATE");
    expect(actionTypes).toContain("CATALOG_PRODUCT_UPDATE");
    expect(actionTypes).toContain("CATALOG_PRODUCT_DEACTIVATE");
    expect(actionTypes).toContain("CATALOG_PRODUCT_ACTIVATE");
    expect(actionTypes).toContain("CATALOG_PRICE_STRIPE_LINK");
    expect(actionTypes).toContain("CATALOG_PRICE_SYNC_FAIL");
  });

  it("enforces DB immutability for activated prices on immutable fields", async () => {
    const created = await createPlan({
      name: "Immutable DB Guard",
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
        id: true,
      },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "Price" SET "unitAmountMinor" = $1 WHERE "id" = $2`,
        4900,
        activePrice?.id ?? "",
      ),
    ).rejects.toThrow("Price immutable fields cannot change after activation/purchase");
  });

  it("blocks immutable field changes in first activation transition update", async () => {
    const product = await prisma.product.create({
      data: {
        name: "First Activation Guard",
        slug: `first-activation-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `first-activation-price-${Date.now()}`,
        name: "First Activation Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 3900,
        stripePriceId: null,
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "Price" SET "stripePriceId" = $1, "unitAmountMinor" = $2 WHERE "id" = $3`,
        "price_activation_transition",
        4900,
        price.id,
      ),
    ).rejects.toThrow("Price immutable fields cannot change after activation/purchase");
  });

  it("blocks immutable field changes after first successful purchase without stripe link", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Purchased Client",
        email: `purchased.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
        emailVerified: new Date(),
      },
      select: { id: true },
    });

    const product = await prisma.product.create({
      data: {
        name: "Purchased Guard Product",
        slug: `purchased-guard-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `purchased-guard-price-${Date.now()}`,
        name: "Purchased Guard Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 3900,
        stripePriceId: null,
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 3900,
        discountAmountMinor: 0,
        totalAmountMinor: 3900,
        currencyCode: "EUR",
      },
      select: { id: true },
    });

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        priceId: price.id,
        quantity: 1,
        productNameSnapshot: "Purchased Guard Product",
        priceNameSnapshot: "Purchased Guard Price",
        unitAmountMinor: 3900,
        lineSubtotalAmountMinor: 3900,
        lineDiscountAmountMinor: 0,
        lineTotalAmountMinor: 3900,
        currencyCode: "EUR",
      },
    });

    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        amountMinor: 3900,
        currencyCode: "EUR",
      },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "Price" SET "currencyCode" = $1 WHERE "id" = $2`,
        "USD",
        price.id,
      ),
    ).rejects.toThrow("Price immutable fields cannot change after activation/purchase");
  });

  it("applies authorized stripe price remediation and writes audit evidence", async () => {
    const created = await createPlan({
      name: "Remediation Plan",
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
        id: true,
        stripePriceId: true,
      },
    });

    await remediatePriceStripeId({
      actor: adminActor,
      priceId: activePrice?.id ?? "",
      stripePriceId: "price_remediated_1",
      reason: "Controlled remediation",
    });

    const remediatedPrice = await prisma.price.findUnique({
      where: { id: activePrice?.id ?? "" },
      select: {
        stripePriceId: true,
        stripeSyncCorrelation: true,
      },
    });
    expect(remediatedPrice?.stripePriceId).toBe("price_remediated_1");
    expect(remediatedPrice?.stripeSyncCorrelation).toMatch(/^remediation-/);

    const remediationAudit = await prisma.auditLog.findFirst({
      where: {
        actionType: "CATALOG_PRICE_STRIPE_REMEDIATION",
        entityType: "Price",
        entityId: activePrice?.id ?? "",
        actorId: adminActor.actorId,
      },
    });
    expect(remediationAudit).not.toBeNull();
  });

  it("keeps a single active non-archived price under concurrent updates", async () => {
    const created = await createPlan({
      name: "Concurrency Plan",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 1,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3900,
    });

    resolveStripeProductIdFromPriceMock.mockResolvedValue("prod_test_existing");

    const updateInput = {
      name: "Concurrency Plan Updated",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      sortOrder: 2,
      priceName: "Concurrency Plan Updated Price",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 4900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    };

    const [first, second] = await Promise.allSettled([
      updatePlan(created?.id ?? "", updateInput),
      updatePlan(created?.id ?? "", updateInput),
    ]);

    expect([first.status, second.status]).toContain("fulfilled");

    const activePrices = await prisma.price.findMany({
      where: {
        productId: created?.id ?? "",
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    expect(activePrices).toHaveLength(1);
  });

  it("passes deterministic idempotency keys to Stripe create calls", async () => {
    const actualPlanProvisioning = await vi.importActual<typeof import("../../src/lib/admin/plan-provisioning")>(
      "../../src/lib/admin/plan-provisioning",
    );

    stripeClientMock.products.create.mockResolvedValue({ id: "prod_new_1" });
    stripeClientMock.prices.create.mockResolvedValue({ id: "price_new_1" });

    const result = await actualPlanProvisioning.provisionPlanOnStripe({
      existingStripeProductId: null,
      syncCorrelation: "admin-update-correlation-1",
      productName: "Monthly Product",
      productDescription: "desc",
      priceName: "Monthly Price",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 8900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    });

    expect(result).toEqual({
      ok: true,
      stripeProductId: "prod_new_1",
      stripePriceId: "price_new_1",
    });
    expect(stripeClientMock.products.create).toHaveBeenCalledWith(
      {
        name: "Monthly Product",
        description: "desc",
        active: true,
      },
      {
        idempotencyKey: buildStripeIdempotencyKey("admin-update-correlation-1", "product-create"),
      },
    );
    expect(stripeClientMock.prices.create).toHaveBeenCalledWith(
      {
        product: "prod_new_1",
        currency: "eur",
        unit_amount: 8900,
        nickname: "Monthly Price",
        recurring: {
          interval: "month",
          interval_count: 1,
        },
      },
      {
        idempotencyKey: buildStripeIdempotencyKey("admin-update-correlation-1", "price-create"),
      },
    );
  });

  it("passes deterministic idempotency keys to Stripe update calls", async () => {
    const actualPlanProvisioning = await vi.importActual<typeof import("../../src/lib/admin/plan-provisioning")>(
      "../../src/lib/admin/plan-provisioning",
    );

    stripeClientMock.products.update.mockResolvedValue({ id: "prod_existing_1" });
    stripeClientMock.prices.create.mockResolvedValue({ id: "price_new_2" });

    const result = await actualPlanProvisioning.provisionPlanOnStripe({
      existingStripeProductId: "prod_existing_1",
      syncCorrelation: "admin-update-correlation-2",
      productName: "Updated Product",
      productDescription: null,
      priceName: "Updated Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "USD",
      unitAmountMinor: 4900,
      billingInterval: null,
      billingIntervalCount: null,
    });

    expect(result).toEqual({
      ok: true,
      stripeProductId: "prod_existing_1",
      stripePriceId: "price_new_2",
    });
    expect(stripeClientMock.products.update).toHaveBeenCalledWith(
      "prod_existing_1",
      {
        name: "Updated Product",
        description: undefined,
        active: true,
      },
      {
        idempotencyKey: buildStripeIdempotencyKey("admin-update-correlation-2", "product-link"),
      },
    );
    expect(stripeClientMock.prices.create).toHaveBeenCalledWith(
      {
        product: "prod_existing_1",
        currency: "usd",
        unit_amount: 4900,
        nickname: "Updated Price",
        recurring: undefined,
      },
      {
        idempotencyKey: buildStripeIdempotencyKey("admin-update-correlation-2", "price-create"),
      },
    );
  });

  it("builds stable Stripe idempotency keys for matching inputs", () => {
    expect(buildStripeIdempotencyKey("corr-123", "price-create")).toBe(
      buildStripeIdempotencyKey("corr-123", "price-create"),
    );
    expect(buildStripeIdempotencyKey("corr-123", "price-create")).not.toBe(
      buildStripeIdempotencyKey("corr-123", "product-create"),
    );
    expect(buildStripeIdempotencyKey("corr-123", "price-create")).not.toBe(
      buildStripeIdempotencyKey("corr-456", "price-create"),
    );
    expect(buildStripeIdempotencyKey("corr-123", "price-create")).toMatch(
      /^catalog-sync:price-create:[a-f0-9]{32}$/,
    );
  });
});

