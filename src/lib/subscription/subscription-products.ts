import { BillingInterval, PriceType, ProductType } from "@prisma/client";
import { prisma } from "@/lib/db";

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

function buildActivePriceWindowWhere(now: Date) {
  return {
    isActive: true,
    isArchived: false,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  } as const;
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
  const now = new Date();
  const activePriceWhere = buildActivePriceWindowWhere(now);
  const products = await prisma.product.findMany({
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
  });

  return products
    .map(mapToCheckoutItem)
    .filter((item): item is SubscriptionCheckoutItem => item !== null)
    .filter((item) => item.checkoutEnabled)
    .map((item) => {
      const { stripePriceId, ...publicItem } = item;
      void stripePriceId;
      return publicItem;
    });
}

export async function getSubscriptionCheckoutItemByProductId(
  productId: string,
): Promise<SubscriptionCheckoutItem | null> {
  const now = new Date();
  const activePriceWhere = buildActivePriceWindowWhere(now);
  const product = await prisma.product.findFirst({
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
  });

  if (!product) {
    return null;
  }

  return mapToCheckoutItem(product);
}

