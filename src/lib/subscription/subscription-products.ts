import { BillingInterval, PriceType, ProductType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPerfTrace } from "@/lib/monitoring/perf-trace";
import { createInMemoryTtlCache } from "@/lib/cache/in-memory-ttl-cache";

export type SubscriptionCatalogItem = {
  productId: string;
  name: string;
  description: string | null;
  productType: ProductType;
  priceId: string;
  priceName: string;
  priceType: PriceType;
  amountMinor: number;
  currencyCode: string;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  checkoutEnabled: boolean;
};

type SubscriptionCheckoutItem = SubscriptionCatalogItem & {
  stripePriceId: string | null;
};

const SUBSCRIPTION_CATALOG_CACHE_TTL_MS = 30_000;
const subscriptionCatalogCache = createInMemoryTtlCache<SubscriptionCatalogItem[]>({
  defaultTtlMs: SUBSCRIPTION_CATALOG_CACHE_TTL_MS,
});
const subscriptionCheckoutItemCache = createInMemoryTtlCache<SubscriptionCheckoutItem | null>({
  defaultTtlMs: SUBSCRIPTION_CATALOG_CACHE_TTL_MS,
});

function buildActivePriceWindowWhere(now: Date): Prisma.PriceWhereInput {
  return {
    isActive: true,
    isArchived: false,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
}

function mapToCheckoutItem(product: {
  id: string;
  name: string;
  description: string | null;
  productType: ProductType;
  prices: Array<{
    id: string;
    name: string;
    priceType: PriceType;
    stripePriceId: string | null;
    unitAmountMinor: number;
    currencyCode: string;
    billingInterval: BillingInterval | null;
    billingIntervalCount: number | null;
  }>;
}): SubscriptionCheckoutItem | null {
  const productPrice = product.prices.find((price) => Boolean(price.stripePriceId)) ?? product.prices[0];
  if (!productPrice) {
    return null;
  }

  return {
    productId: product.id,
    name: product.name,
    description: product.description,
    productType: product.productType,
    priceId: productPrice.id,
    priceName: productPrice.name,
    priceType: productPrice.priceType,
    amountMinor: productPrice.unitAmountMinor,
    currencyCode: productPrice.currencyCode,
    billingInterval: productPrice.billingInterval,
    billingIntervalCount: productPrice.billingIntervalCount,
    stripePriceId: productPrice.stripePriceId,
    checkoutEnabled: Boolean(productPrice.stripePriceId),
  };
}

export async function getActiveSubscriptionCatalogProducts(): Promise<SubscriptionCatalogItem[]> {
  return subscriptionCatalogCache.getOrLoad(
    "active-subscription-catalog-products",
    () => getActiveSubscriptionCatalogProductsRaw(),
    SUBSCRIPTION_CATALOG_CACHE_TTL_MS,
  );
}

async function getActiveSubscriptionCatalogProductsRaw(): Promise<SubscriptionCatalogItem[]> {
  const trace = createPerfTrace("subscription.getActiveSubscriptionCatalogProducts");
  const now = new Date();
  const activePriceWhere = buildActivePriceWindowWhere(now);
  let productCount = 0;
  let checkoutProductCount = 0;
  try {
    const products = await trace.db("product.findMany.activeSubscriptionCatalog", () =>
      prisma.product.findMany({
        where: {
          isActive: true,
          isArchived: false,
          prices: {
            some: activePriceWhere,
          },
        },
        select: {
          id: true,
          name: true,
          description: true,
          productType: true,
          prices: {
            where: activePriceWhere,
            orderBy: [
              { priceType: "asc" },
              { billingIntervalCount: "asc" },
              { unitAmountMinor: "asc" },
              { createdAt: "asc" },
            ],
            select: {
              id: true,
              name: true,
              priceType: true,
              stripePriceId: true,
              unitAmountMinor: true,
              currencyCode: true,
              billingInterval: true,
              billingIntervalCount: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    );
    productCount = products.length;

    const checkoutProducts = products
      .map(mapToCheckoutItem)
      .filter((item): item is SubscriptionCheckoutItem => item !== null)
      .filter((item) => item.checkoutEnabled)
      .map((item) => {
        const { stripePriceId, ...publicItem } = item;
        void stripePriceId;
        return publicItem;
      });
    checkoutProductCount = checkoutProducts.length;
    return checkoutProducts;
  } finally {
    trace.log({ checkoutProductCount, productCount });
  }
}

export async function getSubscriptionCheckoutItemByProductId(
  productId: string,
): Promise<SubscriptionCheckoutItem | null> {
  return subscriptionCheckoutItemCache.getOrLoad(
    productId,
    () => getSubscriptionCheckoutItemByProductIdRaw(productId),
    SUBSCRIPTION_CATALOG_CACHE_TTL_MS,
  );
}

async function getSubscriptionCheckoutItemByProductIdRaw(
  productId: string,
): Promise<SubscriptionCheckoutItem | null> {
  const trace = createPerfTrace("subscription.getSubscriptionCheckoutItemByProductId", { productId });
  const now = new Date();
  const activePriceWhere = buildActivePriceWindowWhere(now);
  let foundProduct = false;
  try {
    const product = await trace.db("product.findFirst.subscriptionByProductId", () =>
      prisma.product.findFirst({
        where: {
          id: productId,
          isActive: true,
          isArchived: false,
          prices: {
            some: activePriceWhere,
          },
        },
        select: {
          id: true,
          name: true,
          description: true,
          productType: true,
          prices: {
            where: activePriceWhere,
            orderBy: [
              { priceType: "asc" },
              { billingIntervalCount: "asc" },
              { unitAmountMinor: "asc" },
              { createdAt: "asc" },
            ],
            select: {
              id: true,
              name: true,
              priceType: true,
              stripePriceId: true,
              unitAmountMinor: true,
              currencyCode: true,
              billingInterval: true,
              billingIntervalCount: true,
            },
          },
        },
      }),
    );

    if (!product) {
      return null;
    }
    foundProduct = true;
    return mapToCheckoutItem(product);
  } finally {
    trace.log({ foundProduct });
  }
}

