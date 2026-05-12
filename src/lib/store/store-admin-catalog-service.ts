import { createHash } from "node:crypto";
import { PriceType, ProductType, StripeSyncStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  STORE_CURRENCY_CODE,
  STORE_MAX_GIFT_CARD_ORDER_TOTAL_MINOR,
  STORE_PICKUP_WORDING,
} from "@/lib/store/store-constants";
import { isStorePriceCheckoutReady } from "@/lib/store/store-catalog";

function generateSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export type StoreAdminValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateMerchandisePriceInput(input: {
  unitAmountMinor: number;
}): StoreAdminValidationResult {
  if (!Number.isInteger(input.unitAmountMinor) || input.unitAmountMinor <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Price must be a positive integer in minor units (e.g. cents)." };
  }
  return { ok: true };
}

export function validateGiftCardAdminPriceInput(input: {
  unitAmountMinor: number;
}): StoreAdminValidationResult {
  if (!Number.isInteger(input.unitAmountMinor) || input.unitAmountMinor <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Gift-card price must be greater than zero." };
  }
  if (input.unitAmountMinor > STORE_MAX_GIFT_CARD_ORDER_TOTAL_MINOR) {
    return { ok: false, code: "AMOUNT_EXCEEDS_CAP", message: "Gift-card price must not exceed 500 EUR." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lookup-key + correlation helpers (mirrors admin-service.ts patterns)
// ---------------------------------------------------------------------------

function buildStoreCorrelation(prefix: "store-create" | "store-update", parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function buildStorePriceLookupKey(productSlug: string, correlationKey: string): string {
  const digest = createHash("sha256")
    .update([productSlug, correlationKey].join("|"))
    .digest("hex")
    .slice(0, 18);
  return `store-${productSlug}-${digest}`;
}

// ---------------------------------------------------------------------------
// Read model types
// ---------------------------------------------------------------------------

type AdminStorePriceRow = {
  id: string;
  name: string;
  lookupKey: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: null;
  billingIntervalCount: null;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
  isActive: boolean;
  isArchived: boolean;
};

export type AdminStoreMerchandiseRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productType: ProductType;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
  primaryPrice: AdminStorePriceRow | null;
  isCheckoutReady: boolean;
};

export type AdminStoreGiftCardRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productType: ProductType;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
  activePrice: AdminStorePriceRow | null;
  isCheckoutReady: boolean;
};

// ---------------------------------------------------------------------------
// Merchandise — list
// ---------------------------------------------------------------------------

export async function listAdminStoreMerchandise(): Promise<AdminStoreMerchandiseRow[]> {
  const products = await prisma.product.findMany({
    where: { productType: ProductType.MERCHANDISE },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      isArchived: true,
      sortOrder: true,
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          lookupKey: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  return products.map((p) => {
    const price = (p.prices[0] as AdminStorePriceRow | undefined) ?? null;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      productType: p.productType,
      isActive: p.isActive,
      isArchived: p.isArchived,
      sortOrder: p.sortOrder,
      primaryPrice: price,
      isCheckoutReady: price !== null && isStorePriceCheckoutReady({ productType: p.productType, productIsActive: p.isActive, productIsArchived: p.isArchived, price }),
    };
  });
}

// ---------------------------------------------------------------------------
// Merchandise — create
// ---------------------------------------------------------------------------

export async function createAdminStoreMerchandise(input: {
  name: string;
  description?: string;
  sortOrder: number;
  priceName?: string;
  unitAmountMinor: number;
  isActive: boolean;
}): Promise<{ id: string }> {
  const amountResult = validateMerchandisePriceInput({ unitAmountMinor: input.unitAmountMinor });
  if (!amountResult.ok) {
    throw new Error(amountResult.code);
  }

  const name = input.name.trim();
  if (!name) throw new Error("NAME_REQUIRED");

  const slugBase = generateSlug(name);
  const slug = slugBase || `merch-${Date.now()}`;
  const priceName = input.priceName?.trim() || name;
  const description = input.description?.trim() || STORE_PICKUP_WORDING;

  const correlation = buildStoreCorrelation("store-create", [
    slug, name, String(input.unitAmountMinor), priceName,
  ]);
  const lookupKey = buildStorePriceLookupKey(slug, correlation);

  const created = await prisma.product.create({
    data: {
      name,
      slug,
      description,
      productType: ProductType.MERCHANDISE,
      isActive: input.isActive,
      isArchived: false,
      sortOrder: input.sortOrder,
      prices: {
        create: {
          lookupKey,
          name: priceName,
          priceType: PriceType.ONE_TIME,
          currencyCode: STORE_CURRENCY_CODE,
          unitAmountMinor: input.unitAmountMinor,
          billingInterval: null,
          billingIntervalCount: null,
          isActive: true,
          isArchived: false,
          stripeSyncStatus: StripeSyncStatus.PENDING,
          stripeSyncCorrelation: correlation,
          stripeSyncLastAttempt: new Date(),
        },
      },
    },
    select: { id: true },
  });

  return { id: created.id };
}

// ---------------------------------------------------------------------------
// Merchandise — update product metadata
// ---------------------------------------------------------------------------

export async function updateAdminStoreMerchandise(
  productId: string,
  input: {
    name: string;
    description?: string;
    sortOrder: number;
    isActive: boolean;
    isArchived: boolean;
  },
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error("NAME_REQUIRED");

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { productType: true },
  });
  if (!product || product.productType !== ProductType.MERCHANDISE) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  await prisma.product.update({
    where: { id: productId },
    data: {
      name,
      description: input.description?.trim() || STORE_PICKUP_WORDING,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      isArchived: input.isArchived,
    },
  });
}

// ---------------------------------------------------------------------------
// Merchandise — get by id (for edit page)
// ---------------------------------------------------------------------------

export async function getAdminStoreMerchandiseById(
  id: string,
): Promise<AdminStoreMerchandiseRow | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      isArchived: true,
      sortOrder: true,
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          lookupKey: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  if (!product || product.productType !== ProductType.MERCHANDISE) return null;

  const price = (product.prices[0] as AdminStorePriceRow | undefined) ?? null;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    productType: product.productType,
    isActive: product.isActive,
    isArchived: product.isArchived,
    sortOrder: product.sortOrder,
    primaryPrice: price,
    isCheckoutReady: price !== null && isStorePriceCheckoutReady({ productType: product.productType, productIsActive: product.isActive, productIsArchived: product.isArchived, price }),
  };
}

// ---------------------------------------------------------------------------
// Gift Card — list
// ---------------------------------------------------------------------------

export async function listAdminStoreGiftCardProducts(): Promise<AdminStoreGiftCardRow[]> {
  const products = await prisma.product.findMany({
    where: { productType: ProductType.GIFT_CARD },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      isArchived: true,
      sortOrder: true,
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          lookupKey: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  return products.map((p) => {
    const price = (p.prices[0] as AdminStorePriceRow | undefined) ?? null;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      productType: p.productType,
      isActive: p.isActive,
      isArchived: p.isArchived,
      sortOrder: p.sortOrder,
      activePrice: price,
      isCheckoutReady: price !== null && isStorePriceCheckoutReady({ productType: p.productType, productIsActive: p.isActive, productIsArchived: p.isArchived, price }),
    };
  });
}

// ---------------------------------------------------------------------------
// Gift Card — create product + price
// ---------------------------------------------------------------------------

export async function createAdminStoreGiftCardProduct(input: {
  name: string;
  description?: string;
  sortOrder: number;
  priceName?: string;
  unitAmountMinor: number;
  isActive: boolean;
}): Promise<{ id: string }> {
  const amountResult = validateGiftCardAdminPriceInput({ unitAmountMinor: input.unitAmountMinor });
  if (!amountResult.ok) {
    throw new Error(amountResult.code);
  }

  const name = input.name.trim();
  if (!name) throw new Error("NAME_REQUIRED");

  const slugBase = generateSlug(name);
  const slug = slugBase || `gift-card-${Date.now()}`;
  const priceName = input.priceName?.trim() || name;
  const description = input.description?.trim() || "Studio gift card for future purchases.";

  const correlation = buildStoreCorrelation("store-create", [
    slug, name, String(input.unitAmountMinor), priceName,
  ]);
  const lookupKey = buildStorePriceLookupKey(slug, correlation);

  const created = await prisma.product.create({
    data: {
      name,
      slug,
      description,
      productType: ProductType.GIFT_CARD,
      isActive: input.isActive,
      isArchived: false,
      sortOrder: input.sortOrder,
      prices: {
        create: {
          lookupKey,
          name: priceName,
          priceType: PriceType.ONE_TIME,
          currencyCode: STORE_CURRENCY_CODE,
          unitAmountMinor: input.unitAmountMinor,
          billingInterval: null,
          billingIntervalCount: null,
          isActive: true,
          isArchived: false,
          stripeSyncStatus: StripeSyncStatus.PENDING,
          stripeSyncCorrelation: correlation,
          stripeSyncLastAttempt: new Date(),
        },
      },
    },
    select: { id: true },
  });

  return { id: created.id };
}

// ---------------------------------------------------------------------------
// Gift Card — get by id (for edit page)
// ---------------------------------------------------------------------------

export async function getAdminStoreGiftCardById(
  id: string,
): Promise<AdminStoreGiftCardRow | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      isArchived: true,
      sortOrder: true,
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          lookupKey: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  if (!product || product.productType !== ProductType.GIFT_CARD) return null;

  const price = (product.prices[0] as AdminStorePriceRow | undefined) ?? null;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    productType: product.productType,
    isActive: product.isActive,
    isArchived: product.isArchived,
    sortOrder: product.sortOrder,
    activePrice: price,
    isCheckoutReady: price !== null && isStorePriceCheckoutReady({ productType: product.productType, productIsActive: product.isActive, productIsArchived: product.isArchived, price }),
  };
}

// ---------------------------------------------------------------------------
// Gift Card — update product metadata and replace active price
// ---------------------------------------------------------------------------

export async function updateAdminStoreGiftCardProduct(
  productId: string,
  input: {
    name: string;
    description?: string;
    sortOrder: number;
    isActive: boolean;
    isArchived: boolean;
    priceName?: string;
    unitAmountMinor: number;
  },
): Promise<void> {
  const amountResult = validateGiftCardAdminPriceInput({ unitAmountMinor: input.unitAmountMinor });
  if (!amountResult.ok) throw new Error(amountResult.code);

  const name = input.name.trim();
  if (!name) throw new Error("NAME_REQUIRED");

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      productType: true,
      slug: true,
      prices: {
        where: { isActive: true, isArchived: false },
        select: { id: true, unitAmountMinor: true },
      },
    },
  });
  if (!product || product.productType !== ProductType.GIFT_CARD) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const priceName = input.priceName?.trim() || name;
  const priceChanged =
    product.prices.length === 0 ||
    product.prices[0].unitAmountMinor !== input.unitAmountMinor;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: {
        name,
        description: input.description?.trim() || "Studio gift card for future purchases.",
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        isArchived: input.isArchived,
      },
    });

    if (priceChanged) {
      if (product.prices.length > 0) {
        await tx.price.updateMany({
          where: { productId, isActive: true, isArchived: false },
          data: { isActive: false },
        });
      }

      const correlation = buildStoreCorrelation("store-update", [
        productId, product.slug, String(input.unitAmountMinor), priceName,
      ]);
      const lookupKey = buildStorePriceLookupKey(product.slug, correlation);

      await tx.price.create({
        data: {
          productId,
          lookupKey,
          name: priceName,
          priceType: PriceType.ONE_TIME,
          currencyCode: STORE_CURRENCY_CODE,
          unitAmountMinor: input.unitAmountMinor,
          billingInterval: null,
          billingIntervalCount: null,
          isActive: true,
          isArchived: false,
          stripeSyncStatus: StripeSyncStatus.PENDING,
          stripeSyncCorrelation: correlation,
          stripeSyncLastAttempt: new Date(),
        },
      });
    } else if (product.prices.length > 0) {
      await tx.price.update({
        where: { id: product.prices[0].id },
        data: { name: priceName },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Gift Card — archive product + deactivate prices
// ---------------------------------------------------------------------------

export async function archiveAdminStoreGiftCardProduct(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { productType: true },
  });
  if (!product || product.productType !== ProductType.GIFT_CARD) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { isActive: false, isArchived: true },
    }),
    prisma.price.updateMany({
      where: { productId, isActive: true },
      data: { isActive: false },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Merchandise — archive product + deactivate prices
// ---------------------------------------------------------------------------

export async function archiveAdminStoreMerchandise(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { productType: true },
  });
  if (!product || product.productType !== ProductType.MERCHANDISE) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { isActive: false, isArchived: true },
    }),
    prisma.price.updateMany({
      where: { productId, isActive: true },
      data: { isActive: false },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Checkout-readiness check for admin display
// ---------------------------------------------------------------------------

export function getStorePriceCheckoutReadinessLabel(
  price: AdminStorePriceRow | null,
  product: { productType: ProductType; isActive: boolean; isArchived: boolean },
): string {
  if (!price) return "No active price";
  if (!price.stripePriceId) return "Needs Stripe sync";
  if (price.stripeSyncStatus !== StripeSyncStatus.SYNCED) return "Stripe sync pending";
  if (!isStorePriceCheckoutReady({ productType: product.productType, productIsActive: product.isActive, productIsArchived: product.isArchived, price })) return "Not ready";
  return "Ready";
}
