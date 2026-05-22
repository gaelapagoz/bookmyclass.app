import "./helpers/setup-env";

import {
  GiftCardCodeStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminStoreMerchandise,
  createAdminStoreGiftCardProduct,
  getAdminStoreMerchandiseById,
  getAdminStoreGiftCardById,
  updateAdminStoreMerchandise,
} from "../../src/lib/store/store-admin-catalog-service";
import { listStoreCatalogReadModels } from "../../src/lib/store/store-catalog";
import { issueGiftCardCode } from "../../src/lib/gift-cards/gift-card-code-service";
import { attemptStorePriceSyncFromEnv } from "../../src/lib/store/store-stripe-sync-service";
import * as stripePayments from "../../src/lib/payments/stripe";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function createMerchandise(unitAmountMinor = 2200) {
  return createAdminStoreMerchandise({
    name: "Test Yoga Mat",
    description: "Pickup at studio.",
    sortOrder: 10,
    unitAmountMinor,
    isActive: true,
  });
}

async function seedGiftCardOrderItem(amountMinor: number) {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await prisma.user.create({
    data: {
      name: "GC Purchaser",
      email: `gc.purchaser.${ts}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true },
  });

  const product = await prisma.product.create({
    data: {
      name: `GC Price Test ${ts}`,
      slug: `gc-price-test-${ts}`,
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
    select: { id: true },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gc-price-test-${ts}`,
      stripePriceId: `price_gc_${ts}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "GC Price Test",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
      isActive: true,
      isArchived: false,
    },
    select: { id: true },
  });

  const order = await prisma.order.create({
    data: {
      clientId: user.id,
      subtotalAmountMinor: amountMinor,
      totalAmountMinor: amountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
      items: {
        create: {
          productId: product.id,
          priceId: price.id,
          productNameSnapshot: `GC Price Test ${ts}`,
          priceNameSnapshot: "GC Price Test",
          unitAmountMinor: amountMinor,
          lineSubtotalAmountMinor: amountMinor,
          lineTotalAmountMinor: amountMinor,
          currencyCode: "EUR",
        },
      },
    },
    include: { items: true },
  });

  return { user, order, product, price };
}

describe("updateAdminStoreMerchandise — price editing", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("editing price creates a new active Price and deactivates the old one", async () => {
    const { id } = await createMerchandise(2200);

    const before = await getAdminStoreMerchandiseById(id);
    const oldPriceId = before!.primaryPrice!.id;

    await updateAdminStoreMerchandise(id, {
      name: "Test Yoga Mat",
      sortOrder: 10,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 2500,
    });

    const after = await getAdminStoreMerchandiseById(id);
    expect(after!.primaryPrice!.unitAmountMinor).toBe(2500);
    expect(after!.primaryPrice!.id).not.toBe(oldPriceId);

    const oldPrice = await prisma.price.findUnique({ where: { id: oldPriceId } });
    expect(oldPrice).not.toBeNull();
    expect(oldPrice!.isActive).toBe(false);
    expect(oldPrice!.isArchived).toBe(false);
  });

  it("old Price record is preserved and historical OrderItem still references it", async () => {
    const { id } = await createMerchandise(3000);

    const before = await getAdminStoreMerchandiseById(id);
    const originalPriceId = before!.primaryPrice!.id;

    const client = await prisma.user.create({
      data: {
        name: "Historical Client",
        email: `historical.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: new Date(),
        isActive: true,
      },
      select: { id: true },
    });

    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 3000,
        totalAmountMinor: 3000,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        items: {
          create: {
            productId: id,
            priceId: originalPriceId,
            productNameSnapshot: "Test Yoga Mat",
            priceNameSnapshot: "Test Yoga Mat",
            unitAmountMinor: 3000,
            lineSubtotalAmountMinor: 3000,
            lineTotalAmountMinor: 3000,
            currencyCode: "EUR",
          },
        },
      },
      include: { items: true },
    });

    await updateAdminStoreMerchandise(id, {
      name: "Test Yoga Mat",
      sortOrder: 10,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 3500,
    });

    const orderItem = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    expect(orderItem!.priceId).toBe(originalPriceId);
    expect(orderItem!.unitAmountMinor).toBe(3000);

    const oldPrice = await prisma.price.findUnique({ where: { id: originalPriceId } });
    expect(oldPrice).not.toBeNull();
  });

  it("price change removes product from client catalog until new price is Stripe-synced", async () => {
    const { id } = await createMerchandise(2200);

    const oldPrice = await prisma.price.findFirst({
      where: { productId: id },
      select: { id: true },
    });

    await prisma.price.update({
      where: { id: oldPrice!.id },
      data: { stripePriceId: "price_test_synced_old", stripeSyncStatus: StripeSyncStatus.SYNCED },
    });

    const catalogBefore = await listStoreCatalogReadModels();
    const entryBefore = catalogBefore.find((p) => p.id === id);
    expect(entryBefore).toBeDefined();
    expect(entryBefore!.checkoutPrices[0]!.unitAmountMinor).toBe(2200);

    await updateAdminStoreMerchandise(id, {
      name: "Test Yoga Mat",
      sortOrder: 10,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 2500,
    });

    const catalogAfter = await listStoreCatalogReadModels();
    expect(catalogAfter.find((p) => p.id === id)).toBeUndefined();

    const admin = await getAdminStoreMerchandiseById(id);
    expect(admin!.primaryPrice!.unitAmountMinor).toBe(2500);
    expect(admin!.primaryPrice!.stripeSyncStatus).toBe(StripeSyncStatus.PENDING);
    expect(admin!.isCheckoutReady).toBe(false);
  });

  it("new price has PENDING Stripe sync status and checkout readiness reason is clear", async () => {
    const { id } = await createMerchandise(2000);

    await updateAdminStoreMerchandise(id, {
      name: "Test Yoga Mat",
      sortOrder: 10,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 2200,
    });

    const after = await getAdminStoreMerchandiseById(id);
    expect(after!.primaryPrice!.stripeSyncStatus).toBe(StripeSyncStatus.PENDING);
    expect(after!.primaryPrice!.stripePriceId).toBeNull();
    expect(after!.isCheckoutReady).toBe(false);
  });

  it("price-only update does not change product name or metadata", async () => {
    const { id } = await createMerchandise(2200);

    await updateAdminStoreMerchandise(id, {
      name: "Updated Name",
      description: "New desc. Pickup at studio.",
      sortOrder: 5,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 2200,
    });

    const after = await getAdminStoreMerchandiseById(id);
    expect(after!.name).toBe("Updated Name");
    expect(after!.sortOrder).toBe(5);
    expect(after!.primaryPrice!.unitAmountMinor).toBe(2200);
  });

  it("same price amount does not create a duplicate Price record", async () => {
    const { id } = await createMerchandise(2200);

    const before = await getAdminStoreMerchandiseById(id);
    const priceIdBefore = before!.primaryPrice!.id;

    await updateAdminStoreMerchandise(id, {
      name: "Test Yoga Mat",
      sortOrder: 10,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 2200,
    });

    const after = await getAdminStoreMerchandiseById(id);
    expect(after!.primaryPrice!.id).toBe(priceIdBefore);

    const priceCount = await prisma.price.count({ where: { productId: id } });
    expect(priceCount).toBe(1);
  });

  it("rejects zero price server-side", async () => {
    const { id } = await createMerchandise(2200);
    await expect(
      updateAdminStoreMerchandise(id, {
        name: "Test Yoga Mat",
        sortOrder: 10,
        isActive: true,
        isArchived: false,
        unitAmountMinor: 0,
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  it("rejects negative price server-side", async () => {
    const { id } = await createMerchandise(2200);
    await expect(
      updateAdminStoreMerchandise(id, {
        name: "Test Yoga Mat",
        sortOrder: 10,
        isActive: true,
        isArchived: false,
        unitAmountMinor: -100,
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  it("rejects fractional-cent price server-side", async () => {
    const { id } = await createMerchandise(2200);
    await expect(
      updateAdminStoreMerchandise(id, {
        name: "Test Yoga Mat",
        sortOrder: 10,
        isActive: true,
        isArchived: false,
        unitAmountMinor: 22.5,
      }),
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  it("rejects non-merchandise product ID", async () => {
    const giftCard = await prisma.product.create({
      data: {
        name: "Gift Card",
        slug: `gc-wrong-type-${Date.now()}`,
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });

    await expect(
      updateAdminStoreMerchandise(giftCard.id, {
        name: "Gift Card",
        sortOrder: 1,
        isActive: true,
        isArchived: false,
        unitAmountMinor: 2500,
      }),
    ).rejects.toThrow("PRODUCT_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — auto-sync wiring on create (Stripe not configured in test env)
// ---------------------------------------------------------------------------

describe("createAdminStoreMerchandise — auto-sync wiring on create", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates merchandise with PENDING sync status when Stripe is not configured", async () => {
    // STRIPE_SECRET_KEY is absent in the integration test environment.
    // attemptStorePriceSyncFromEnv returns null → price stays PENDING without error.
    const { id } = await createAdminStoreMerchandise({
      name: "Auto Sync Wiring Test Mat",
      sortOrder: 1,
      unitAmountMinor: 1500,
      isActive: true,
    });

    const product = await getAdminStoreMerchandiseById(id);
    expect(product).not.toBeNull();
    expect(product!.primaryPrice).not.toBeNull();
    expect(product!.primaryPrice!.stripeSyncStatus).toBe(StripeSyncStatus.PENDING);
    expect(product!.primaryPrice!.stripePriceId).toBeNull();
    // stripeSyncLastAttempt is null at creation — only set during an actual sync attempt
    const rawPrice = await prisma.price.findFirst({ where: { productId: id } });
    expect(rawPrice!.stripeSyncLastAttempt).toBeNull();
    expect(product!.isCheckoutReady).toBe(false);
  });

  it("creates gift card with PENDING sync status when Stripe is not configured", async () => {
    const { id } = await createAdminStoreGiftCardProduct({
      name: "Auto Sync Wiring Test GC",
      sortOrder: 1,
      unitAmountMinor: 2500,
      isActive: true,
    });

    const product = await getAdminStoreGiftCardById(id);
    expect(product).not.toBeNull();
    expect(product!.activePrice).not.toBeNull();
    expect(product!.activePrice!.stripeSyncStatus).toBe(StripeSyncStatus.PENDING);
    expect(product!.activePrice!.stripePriceId).toBeNull();
    const rawPrice = await prisma.price.findFirst({ where: { productId: id } });
    expect(rawPrice!.stripeSyncLastAttempt).toBeNull();
    expect(product!.isCheckoutReady).toBe(false);
  });
});

describe("GiftCardCode amountMinor is preserved after gift-card price change", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issued GiftCardCode retains original amountMinor after gift-card product price is changed", async () => {
    const { user, order } = await seedGiftCardOrderItem(2500);
    const orderItemId = order.items[0]!.id;
    const giftCardProductId = order.items[0]!.productId;

    const issued = await issueGiftCardCode({
      orderId: order.id,
      orderItemId,
      purchasedById: user.id,
      amountMinor: 2500,
    });
    expect(issued.alreadyIssued).toBe(false);

    const { updateAdminStoreGiftCardProduct } = await import(
      "../../src/lib/store/store-admin-catalog-service"
    );
    await updateAdminStoreGiftCardProduct(giftCardProductId, {
      name: "GC New Price",
      sortOrder: 1,
      isActive: true,
      isArchived: false,
      unitAmountMinor: 5000,
    });

    const code = await prisma.giftCardCode.findUnique({ where: { orderItemId } });
    expect(code!.status).toBe(GiftCardCodeStatus.ISSUED);
    expect(code!.amountMinor).toBe(2500);
  });
});

describe("attemptStorePriceSyncFromEnv central boundary integration", () => {
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;
  const originalAllowLive = process.env.ALLOW_LIVE_STORE_SYNC;

  beforeEach(async () => {
    await resetDb();
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
    process.env.ALLOW_LIVE_STORE_SYNC = originalAllowLive;
    vi.restoreAllMocks();
  });

  it("uses centralized keyed client and keeps store sync behavior unchanged", async () => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const product = await prisma.product.create({
      data: {
        name: `Integration Sync Mat ${ts}`,
        slug: `integration-sync-mat-${ts}`,
        productType: ProductType.MERCHANDISE,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `store-integration-sync-${ts}`,
        stripePriceId: null,
        stripeSyncStatus: StripeSyncStatus.PENDING,
        name: "Integration Sync Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 1800,
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    const stripeMock = {
      products: {
        search: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ id: "prod_integration_sync_1" }),
      },
      prices: {
        retrieve: vi.fn(),
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ id: "price_integration_synced_1" }),
      },
    } as unknown as import("stripe").default;
    const keyedClientSpy = vi
      .spyOn(stripePayments, "getStripeClientForSecretKey")
      .mockReturnValue(stripeMock);

    process.env.STRIPE_SECRET_KEY = "sk_test_integration_sync_key";
    delete process.env.ALLOW_LIVE_STORE_SYNC;

    const result = await attemptStorePriceSyncFromEnv(price.id);

    expect(result).toEqual({
      synced: true,
      stripePriceId: "price_integration_synced_1",
      created: true,
    });
    expect(keyedClientSpy).toHaveBeenCalledWith("sk_test_integration_sync_key");
    expect(stripeMock.prices.create).toHaveBeenCalledOnce();

    const updatedPrice = await prisma.price.findUnique({
      where: { id: price.id },
      select: { stripeSyncStatus: true, stripePriceId: true, stripeSyncErrorCode: true },
    });
    expect(updatedPrice).not.toBeNull();
    expect(updatedPrice!.stripeSyncStatus).toBe(StripeSyncStatus.SYNCED);
    expect(updatedPrice!.stripePriceId).toBe("price_integration_synced_1");
    expect(updatedPrice!.stripeSyncErrorCode).toBeNull();
  });

  it("blocks live mode unless ALLOW_LIVE_STORE_SYNC equals 1 exactly", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_integration_sync_key";
    process.env.ALLOW_LIVE_STORE_SYNC = "true";

    const keyedClientSpy = vi.spyOn(stripePayments, "getStripeClientForSecretKey");
    const result = await attemptStorePriceSyncFromEnv("non-existent-price");

    expect(result).toEqual({
      synced: false,
      reason: "Live Stripe key requires ALLOW_LIVE_STORE_SYNC=1 to proceed.",
    });
    expect(keyedClientSpy).not.toHaveBeenCalled();
  });
});
