import { PriceType, ProductType, StripeSyncStatus, type BillingInterval } from "@prisma/client";

import { isCatalogPriceCheckoutReady } from "@/lib/catalog/checkout-readiness";
import { PLAN_PRODUCT_TYPES, STORE_PRODUCT_TYPES } from "@/lib/catalog/product-scopes";
import { prisma } from "@/lib/db";

export type ProductionCatalogPrice = {
  id: string;
  lookupKey: string;
  name: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
  isActive: boolean;
  isArchived: boolean;
  product: {
    id: string;
    slug: string;
    name: string;
    productType: ProductType;
    isActive: boolean;
    isArchived: boolean;
  };
};

export type ProductionCatalogReadinessStatus = "READY" | "BLOCKED";

export type ProductionCatalogReadinessRow = {
  productSlug: string;
  productName: string;
  productType: ProductType;
  priceLookupKey: string;
  priceName: string;
  status: ProductionCatalogReadinessStatus;
  reasons: string[];
};

export type ProductionCatalogReadinessResult = {
  ok: boolean;
  checkedCount: number;
  blockedCount: number;
  rows: ProductionCatalogReadinessRow[];
};

function expectedPriceShapeReasons(price: ProductionCatalogPrice): string[] {
  const reasons: string[] = [];

  if (!/^[A-Z]{3}$/.test(price.currencyCode)) {
    reasons.push(`currency ${price.currencyCode} is not a 3-letter uppercase code`);
  }

  if (!Number.isInteger(price.unitAmountMinor) || price.unitAmountMinor <= 0) {
    reasons.push(`amount ${price.unitAmountMinor} is not a positive integer`);
  }

  if (price.product.productType === ProductType.UNLIMITED_MEMBERSHIP) {
    if (price.priceType !== PriceType.RECURRING) {
      reasons.push("membership price must be RECURRING");
    }
    if (!price.billingInterval || !price.billingIntervalCount || price.billingIntervalCount <= 0) {
      reasons.push("membership price must define a positive billing interval");
    }
    return reasons;
  }

  if (price.priceType !== PriceType.ONE_TIME) {
    reasons.push(`${price.product.productType} price must be ONE_TIME`);
  }

  if (price.billingInterval !== null || price.billingIntervalCount !== null) {
    reasons.push("one-time price must not define billing interval fields");
  }

  if (STORE_PRODUCT_TYPES.includes(price.product.productType) && price.currencyCode !== "EUR") {
    reasons.push("Store price must be EUR");
  }

  return reasons;
}

export function evaluateProductionCatalogReadiness(
  prices: readonly ProductionCatalogPrice[],
): ProductionCatalogReadinessResult {
  const rows = prices.map((price): ProductionCatalogReadinessRow => {
    const reasons: string[] = [];

    if (!price.product.isActive || price.product.isArchived) {
      reasons.push("product is inactive or archived");
    }
    if (!price.isActive || price.isArchived) {
      reasons.push("price is inactive or archived");
    }
    if (!price.stripePriceId) {
      reasons.push("missing stripePriceId");
    }
    if (price.stripeSyncStatus !== StripeSyncStatus.SYNCED) {
      reasons.push(`stripeSyncStatus is ${price.stripeSyncStatus}`);
    }

    reasons.push(...expectedPriceShapeReasons(price));

    if (!isCatalogPriceCheckoutReady(price)) {
      reasons.push("checkout readiness invariant failed");
    }

    const uniqueReasons = Array.from(new Set(reasons));

    return {
      productSlug: price.product.slug,
      productName: price.product.name,
      productType: price.product.productType,
      priceLookupKey: price.lookupKey,
      priceName: price.name,
      status: uniqueReasons.length === 0 ? "READY" : "BLOCKED",
      reasons: uniqueReasons,
    };
  });

  const blockedCount = rows.filter((row) => row.status === "BLOCKED").length;

  return {
    ok: blockedCount === 0,
    checkedCount: rows.length,
    blockedCount,
    rows,
  };
}

export async function verifyProductionCatalogReadiness(): Promise<ProductionCatalogReadinessResult> {
  const prices = await prisma.price.findMany({
    where: {
      isActive: true,
      isArchived: false,
      product: {
        isActive: true,
        isArchived: false,
        productType: { in: [...PLAN_PRODUCT_TYPES, ...STORE_PRODUCT_TYPES] as ProductType[] },
      },
    },
    orderBy: [{ product: { sortOrder: "asc" } }, { product: { name: "asc" } }, { unitAmountMinor: "asc" }],
    select: {
      id: true,
      lookupKey: true,
      name: true,
      priceType: true,
      currencyCode: true,
      unitAmountMinor: true,
      billingInterval: true,
      billingIntervalCount: true,
      stripePriceId: true,
      stripeSyncStatus: true,
      isActive: true,
      isArchived: true,
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          productType: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  return evaluateProductionCatalogReadiness(prices);
}
