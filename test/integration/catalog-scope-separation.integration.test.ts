import "./helpers/setup-env";

import { BillingInterval, PriceType, ProductType, StripeSyncStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getActiveSubscriptionCatalogProducts,
  getSubscriptionCheckoutItemByProductId,
} from "../../src/lib/subscription/subscription-products";
import { getAdminPlansData } from "../../src/lib/admin/admin-service";
import { listStoreCatalogReadModels } from "../../src/lib/store/store-catalog";
import {
  PLAN_PRODUCT_TYPES,
  STORE_PRODUCT_TYPES,
  isPlanProductType,
  isStoreProductType,
} from "../../src/lib/catalog/product-scopes";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createPlanProduct(productType: ProductType, opts: { name?: string } = {}) {
  const name = opts.name ?? `Plan ${productType}`;
  const slug = `plan-${productType.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.product.create({
    data: {
      name,
      slug,
      productType,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      prices: {
        create: {
          name: `${name} Price`,
          lookupKey: `lookup-${slug}`,
          priceType: PriceType.RECURRING,
          currencyCode: "EUR",
          unitAmountMinor: 7900,
          billingInterval: BillingInterval.MONTH,
          billingIntervalCount: 1,
          stripePriceId: `price_test_${slug}`,
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          isActive: true,
          isArchived: false,
        },
      },
    },
    select: { id: true, productType: true },
  });
}

async function createStoreProduct(productType: ProductType.GIFT_CARD | ProductType.MERCHANDISE, opts: { name?: string } = {}) {
  const name = opts.name ?? `Store ${productType}`;
  const slug = `store-${productType.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.product.create({
    data: {
      name,
      slug,
      productType,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      prices: {
        create: {
          name: `${name} Price`,
          lookupKey: `lookup-${slug}`,
          priceType: PriceType.ONE_TIME,
          currencyCode: "EUR",
          unitAmountMinor: 2500,
          billingInterval: null,
          billingIntervalCount: null,
          stripePriceId: `price_test_${slug}`,
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          isActive: true,
          isArchived: false,
        },
      },
    },
    select: { id: true, productType: true },
  });
}

// ---------------------------------------------------------------------------

describe("catalog scope separation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // --- constant correctness ---

  it("PLAN_PRODUCT_TYPES contains only plan types", () => {
    expect(PLAN_PRODUCT_TYPES).toContain(ProductType.DROP_IN_CLASS);
    expect(PLAN_PRODUCT_TYPES).toContain(ProductType.CLASS_PACK);
    expect(PLAN_PRODUCT_TYPES).toContain(ProductType.PRIVATE_PACK);
    expect(PLAN_PRODUCT_TYPES).toContain(ProductType.UNLIMITED_MEMBERSHIP);
    expect(PLAN_PRODUCT_TYPES).not.toContain(ProductType.GIFT_CARD);
    expect(PLAN_PRODUCT_TYPES).not.toContain(ProductType.MERCHANDISE);
  });

  it("STORE_PRODUCT_TYPES contains only store types", () => {
    expect(STORE_PRODUCT_TYPES).toContain(ProductType.GIFT_CARD);
    expect(STORE_PRODUCT_TYPES).toContain(ProductType.MERCHANDISE);
    expect(STORE_PRODUCT_TYPES).not.toContain(ProductType.DROP_IN_CLASS);
    expect(STORE_PRODUCT_TYPES).not.toContain(ProductType.CLASS_PACK);
    expect(STORE_PRODUCT_TYPES).not.toContain(ProductType.PRIVATE_PACK);
    expect(STORE_PRODUCT_TYPES).not.toContain(ProductType.UNLIMITED_MEMBERSHIP);
  });

  it("isPlanProductType and isStoreProductType are mutually exclusive — no type is both", () => {
    const allTypes = Object.values(ProductType);
    for (const t of allTypes) {
      expect(isPlanProductType(t) && isStoreProductType(t)).toBe(false);
    }
  });

  // --- subscription catalog excludes store products ---

  it("getActiveSubscriptionCatalogProducts excludes GIFT_CARD products", async () => {
    const planProduct = await createPlanProduct(ProductType.UNLIMITED_MEMBERSHIP);
    const storeProduct = await createStoreProduct(ProductType.GIFT_CARD);

    const catalog = await getActiveSubscriptionCatalogProducts();
    const ids = catalog.map((c) => c.productId);

    expect(ids).toContain(planProduct.id);
    expect(ids).not.toContain(storeProduct.id);
  });

  it("getActiveSubscriptionCatalogProducts excludes MERCHANDISE products", async () => {
    const planProduct = await createPlanProduct(ProductType.CLASS_PACK);
    const storeProduct = await createStoreProduct(ProductType.MERCHANDISE);

    const catalog = await getActiveSubscriptionCatalogProducts();
    const ids = catalog.map((c) => c.productId);

    expect(ids).toContain(planProduct.id);
    expect(ids).not.toContain(storeProduct.id);
  });

  it("getActiveSubscriptionCatalogProducts returns all plan product types", async () => {
    const planTypes: ProductType[] = [
      ProductType.UNLIMITED_MEMBERSHIP,
      ProductType.CLASS_PACK,
      ProductType.DROP_IN_CLASS,
      ProductType.PRIVATE_PACK,
    ];
    const created = await Promise.all(planTypes.map((t) => createPlanProduct(t)));

    const catalog = await getActiveSubscriptionCatalogProducts();
    const ids = catalog.map((c) => c.productId);

    for (const p of created) {
      expect(ids).toContain(p.id);
    }
  });

  // --- admin plans page excludes store products ---

  it("getAdminPlansData excludes GIFT_CARD products", async () => {
    const planProduct = await createPlanProduct(ProductType.UNLIMITED_MEMBERSHIP);
    const storeProduct = await createStoreProduct(ProductType.GIFT_CARD);

    const list = await getAdminPlansData();
    const ids = list.map((p) => p.id);

    expect(ids).toContain(planProduct.id);
    expect(ids).not.toContain(storeProduct.id);
  });

  it("getAdminPlansData excludes MERCHANDISE products", async () => {
    const planProduct = await createPlanProduct(ProductType.DROP_IN_CLASS);
    const storeProduct = await createStoreProduct(ProductType.MERCHANDISE);

    const list = await getAdminPlansData();
    const ids = list.map((p) => p.id);

    expect(ids).toContain(planProduct.id);
    expect(ids).not.toContain(storeProduct.id);
  });

  // --- store catalog excludes plan products ---

  it("listStoreCatalogReadModels excludes plan products", async () => {
    const unlimitedMembership = await createPlanProduct(ProductType.UNLIMITED_MEMBERSHIP);
    const classPack = await createPlanProduct(ProductType.CLASS_PACK);
    const storeProduct = await createStoreProduct(ProductType.GIFT_CARD);

    const readModels = await listStoreCatalogReadModels();
    const ids = readModels.map((p) => p.id);

    expect(ids).toContain(storeProduct.id);
    expect(ids).not.toContain(unlimitedMembership.id);
    expect(ids).not.toContain(classPack.id);
  });

  it("listStoreCatalogReadModels includes only GIFT_CARD and MERCHANDISE", async () => {
    const giftCard = await createStoreProduct(ProductType.GIFT_CARD);
    const merch = await createStoreProduct(ProductType.MERCHANDISE);
    await createPlanProduct(ProductType.DROP_IN_CLASS);
    await createPlanProduct(ProductType.CLASS_PACK);
    await createPlanProduct(ProductType.PRIVATE_PACK);
    await createPlanProduct(ProductType.UNLIMITED_MEMBERSHIP);

    const readModels = await listStoreCatalogReadModels();
    const ids = readModels.map((p) => p.id);
    const types = readModels.map((p) => p.productType);

    expect(ids).toContain(giftCard.id);
    expect(ids).toContain(merch.id);
    for (const t of types) {
      expect(isStoreProductType(t)).toBe(true);
      expect(isPlanProductType(t)).toBe(false);
    }
  });

  // --- getSubscriptionCheckoutItemByProductId scope guard ---

  it("getSubscriptionCheckoutItemByProductId returns null for a GIFT_CARD product ID", async () => {
    const storeProduct = await createStoreProduct(ProductType.GIFT_CARD);
    const result = await getSubscriptionCheckoutItemByProductId(storeProduct.id);
    expect(result).toBeNull();
  });

  it("getSubscriptionCheckoutItemByProductId returns null for a MERCHANDISE product ID", async () => {
    const storeProduct = await createStoreProduct(ProductType.MERCHANDISE);
    const result = await getSubscriptionCheckoutItemByProductId(storeProduct.id);
    expect(result).toBeNull();
  });

  // --- cross-contamination regression ---

  it("store products never appear in subscription catalog regardless of Stripe sync", async () => {
    await createStoreProduct(ProductType.GIFT_CARD);
    await createStoreProduct(ProductType.MERCHANDISE);

    const catalog = await getActiveSubscriptionCatalogProducts();
    for (const item of catalog) {
      expect(isStoreProductType(item.productType)).toBe(false);
    }
  });

  it("plan products never appear in store read models regardless of Stripe sync", async () => {
    for (const t of PLAN_PRODUCT_TYPES) {
      await createPlanProduct(t);
    }

    const readModels = await listStoreCatalogReadModels();
    for (const item of readModels) {
      expect(isPlanProductType(item.productType)).toBe(false);
    }
  });
});
