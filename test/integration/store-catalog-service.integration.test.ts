import "./helpers/setup-env";

import {
  PriceType,
  ProductType,
  StripeSyncStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_PICKUP_WORDING,
  listStoreCatalogReadModels,
  validateGiftCardPriceForCheckoutExposure,
} from "../../src/lib/store/store-catalog";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;

// ---------------------------------------------------------------------------
// Helpers — create store products using the canonical seed-data slugs/keys.
// ---------------------------------------------------------------------------

async function createTestGiftCardProduct(overrides: {
  slug?: string;
  lookupKey?: string;
  unitAmountMinor?: number;
  stripePriceId?: string;
  stripeSyncStatus?: StripeSyncStatus;
  isActive?: boolean;
  isArchived?: boolean;
  currencyCode?: string;
  priceType?: PriceType;
} = {}) {
  const slug = overrides.slug ?? "store-gift-card-25-eur";
  const lookupKey = overrides.lookupKey ?? "store-gift-card-25-eur-once-v1";
  const product = await prisma.product.create({
    data: {
      name: "Gift Card €25",
      slug,
      description: "A €25 gift card.",
      productType: ProductType.GIFT_CARD,
      isActive: overrides.isActive ?? true,
      isArchived: overrides.isArchived ?? false,
      sortOrder: 70,
      prices: {
        create: {
          name: "Gift Card €25 - One Time",
          lookupKey,
          priceType: overrides.priceType ?? PriceType.ONE_TIME,
          currencyCode: overrides.currencyCode ?? "EUR",
          unitAmountMinor: overrides.unitAmountMinor ?? 2_500,
          stripePriceId: overrides.stripePriceId ?? null,
          stripeSyncStatus: overrides.stripeSyncStatus ?? StripeSyncStatus.PENDING,
          isActive: overrides.isActive ?? true,
          isArchived: overrides.isArchived ?? false,
        },
      },
    },
    select: { id: true },
  });
  return product;
}

async function createTestMerchandiseProduct(overrides: {
  slug?: string;
  lookupKey?: string;
  stripePriceId?: string;
  stripeSyncStatus?: StripeSyncStatus;
  isActive?: boolean;
} = {}) {
  const slug = overrides.slug ?? "store-merch-studio-tote";
  const lookupKey = overrides.lookupKey ?? "store-merch-studio-tote-eur-once-v1";
  const product = await prisma.product.create({
    data: {
      name: "Studio Tote Bag",
      slug,
      description: "Canvas tote bag.",
      productType: ProductType.MERCHANDISE,
      isActive: overrides.isActive ?? true,
      isArchived: false,
      sortOrder: 120,
      prices: {
        create: {
          name: "Studio Tote Bag - One Time",
          lookupKey,
          priceType: PriceType.ONE_TIME,
          currencyCode: "EUR",
          unitAmountMinor: 3_000,
          stripePriceId: overrides.stripePriceId ?? null,
          stripeSyncStatus: overrides.stripeSyncStatus ?? StripeSyncStatus.PENDING,
          isActive: true,
          isArchived: false,
        },
      },
    },
    select: { id: true },
  });
  return product;
}

// ---------------------------------------------------------------------------

describe("store catalog service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
  });

  it("reads DB-backed store products only — no hard-coded defaults", async () => {
    const readModelsEmpty = await listStoreCatalogReadModels();
    expect(readModelsEmpty).toHaveLength(0);

    await createTestGiftCardProduct({ stripePriceId: "price_test_gc25", stripeSyncStatus: StripeSyncStatus.SYNCED });
    const readModels = await listStoreCatalogReadModels();
    expect(readModels).toHaveLength(1);
    expect(readModels[0].productType).toBe(ProductType.GIFT_CARD);
  });

  it("store products carry no entitlement rules", async () => {
    await createTestGiftCardProduct({ stripePriceId: "price_test_gc25", stripeSyncStatus: StripeSyncStatus.SYNCED });
    await createTestMerchandiseProduct({ stripePriceId: "price_test_merch", stripeSyncStatus: StripeSyncStatus.SYNCED });

    expect(await prisma.entitlementRule.count()).toBe(0);
  });

  it("exposes active checkout-ready gift-card and merchandise products in store read models", async () => {
    const syncedGiftCard = await createTestGiftCardProduct({
      slug: "store-gift-card-25-eur",
      lookupKey: "store-gift-card-25-eur-once-v1",
      stripePriceId: "price_test_gc25",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const syncedGiftCardPrice = await prisma.price.findFirstOrThrow({ where: { productId: syncedGiftCard.id }, select: { id: true } });

    const syncedMerch = await createTestMerchandiseProduct({
      slug: "store-merch-studio-tote",
      lookupKey: "store-merch-studio-tote-eur-once-v1",
      stripePriceId: "price_test_merch_tote",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const syncedMerchandisePrice = await prisma.price.findFirstOrThrow({ where: { productId: syncedMerch.id }, select: { id: true } });

    // Unsynced gift card — should be excluded
    await createTestGiftCardProduct({
      slug: "unsynced-gift-card",
      lookupKey: "store-gift-card-unsynced",
      stripePriceId: "price_unsynced",
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });

    // USD gift card — should be excluded
    const usdProduct = await prisma.product.create({
      data: {
        name: "USD Gift Card",
        slug: "usd-gift-card",
        productType: ProductType.GIFT_CARD,
        prices: {
          create: {
            name: "USD Gift Card",
            lookupKey: "store-gift-card-usd",
            priceType: PriceType.ONE_TIME,
            currencyCode: "USD",
            unitAmountMinor: 1_500,
            stripePriceId: "price_usd",
            stripeSyncStatus: StripeSyncStatus.SYNCED,
          },
        },
      },
      select: { id: true },
    });

    // Inactive product — should be excluded
    const inactiveProduct = await createTestGiftCardProduct({
      slug: "inactive-gc",
      lookupKey: "store-gift-card-inactive",
      stripePriceId: "price_inactive",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      isActive: false,
    });

    // No-price product — should be excluded
    const noPriceProduct = await prisma.product.create({
      data: { name: "No Price Store Product", slug: "no-price-store-product", productType: ProductType.MERCHANDISE },
      select: { id: true },
    });

    const readModels = await listStoreCatalogReadModels();
    const checkoutPriceIds = readModels.flatMap((p) => p.checkoutPrices.map((pr) => pr.id));
    const productIds = readModels.map((p) => p.id);

    expect(checkoutPriceIds).toContain(syncedGiftCardPrice.id);
    expect(checkoutPriceIds).toContain(syncedMerchandisePrice.id);
    expect(readModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productType: ProductType.GIFT_CARD, checkoutPrices: [expect.objectContaining({ id: syncedGiftCardPrice.id })] }),
        expect.objectContaining({ productType: ProductType.MERCHANDISE, fulfillmentLabel: STORE_PICKUP_WORDING, checkoutPrices: [expect.objectContaining({ id: syncedMerchandisePrice.id })] }),
      ]),
    );
    expect(productIds).not.toContain(usdProduct.id);
    expect(productIds).not.toContain(inactiveProduct.id);
    expect(productIds).not.toContain(noPriceProduct.id);
  });

  it("requires synced checkout-ready Stripe prices for admin gift-card exposure", () => {
    const base = {
      productType: ProductType.GIFT_CARD,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2_500,
      billingInterval: null,
      billingIntervalCount: null,
      isActive: true,
      isArchived: false,
      stripePriceId: "price_ready",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    };

    expect(validateGiftCardPriceForCheckoutExposure(base)).toEqual({ ok: true });
    expect(validateGiftCardPriceForCheckoutExposure({ ...base, currencyCode: "USD" })).toMatchObject({
      ok: false,
      code: "INVALID_CURRENCY",
    });
    expect(validateGiftCardPriceForCheckoutExposure({ ...base, unitAmountMinor: 50_001 })).toEqual({ ok: true });
    expect(validateGiftCardPriceForCheckoutExposure({ ...base, priceType: PriceType.RECURRING })).toMatchObject({
      ok: false,
      code: "INVALID_PRICE_TYPE",
    });
    expect(validateGiftCardPriceForCheckoutExposure({ ...base, stripeSyncStatus: StripeSyncStatus.PENDING })).toMatchObject({
      ok: false,
      code: "STRIPE_NOT_READY",
    });
  });

  it("rejects wrong-environment synced Stripe price IDs before checkout exposure", () => {
    const base = {
      productType: ProductType.GIFT_CARD,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2_500,
      billingInterval: null,
      billingIntervalCount: null,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    };

    process.env.STRIPE_SECRET_KEY = "sk_live_123";
    expect(validateGiftCardPriceForCheckoutExposure({ ...base, stripePriceId: "price_test_wrong_env" })).toMatchObject({
      ok: false,
      code: "STRIPE_NOT_READY",
    });

    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(validateGiftCardPriceForCheckoutExposure({ ...base, stripePriceId: "price_live_wrong_env" })).toMatchObject({
      ok: false,
      code: "STRIPE_NOT_READY",
    });
  });
});

