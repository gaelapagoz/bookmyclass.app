import { validateCartAgainstCatalog } from "@/lib/cart/cart-validation";
import type {
  CartResolvedCatalogPrice,
  CartSubscriptionSnapshot,
  CartValidationServiceDependencies,
  CartValidationServiceInput,
} from "@/lib/cart/cart-types";
import { isActiveSubscriptionForCartConstraint } from "@/lib/cart/cart-contract";

async function getCatalogPricesByIds(priceIds: string[]): Promise<CartResolvedCatalogPrice[]> {
  const { prisma } = await import("@/lib/db");
  if (priceIds.length === 0) {
    return [];
  }

  const prices = await prisma.price.findMany({
    where: {
      id: { in: priceIds },
    },
    select: {
      id: true,
      productId: true,
      name: true,
      priceType: true,
      unitAmountMinor: true,
      currencyCode: true,
      billingInterval: true,
      billingIntervalCount: true,
      stripePriceId: true,
      isActive: true,
      isArchived: true,
      startsAt: true,
      endsAt: true,
      product: {
        select: {
          name: true,
          description: true,
          productType: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  return prices.map((price) => ({
    priceId: price.id,
    productId: price.productId,
    productName: price.product.name,
    productDescription: price.product.description,
    productType: price.product.productType,
    priceName: price.name,
    priceType: price.priceType,
    unitAmountMinor: price.unitAmountMinor,
    currencyCode: price.currencyCode,
    billingInterval: price.billingInterval,
    billingIntervalCount: price.billingIntervalCount,
    checkoutEnabled: Boolean(price.stripePriceId),
    productIsActive: price.product.isActive,
    productIsArchived: price.product.isArchived,
    priceIsActive: price.isActive,
    priceIsArchived: price.isArchived,
    priceStartsAt: price.startsAt,
    priceEndsAt: price.endsAt,
  }));
}

async function getClientSubscriptionSnapshots(clientId: string): Promise<CartSubscriptionSnapshot[]> {
  const { prisma } = await import("@/lib/db");
  const contracts = await prisma.subscriptionContract.findMany({
    where: { clientId },
    select: {
      status: true,
      currentPeriodEnd: true,
      endedAt: true,
    },
  });

  return contracts;
}

function defaultDependencies(): CartValidationServiceDependencies {
  return {
    getCatalogPricesByIds,
    getClientSubscriptionSnapshots,
    now: () => new Date(),
  };
}

export function createCartValidationService(
  dependencies: Partial<CartValidationServiceDependencies> = {},
) {
  const deps: CartValidationServiceDependencies = {
    ...defaultDependencies(),
    ...dependencies,
  };

  return {
    async validate(input: CartValidationServiceInput) {
      const priceIds = [...new Set(input.lines.map((line) => line.priceId.trim()))];
      const [catalogPrices, subscriptions] = await Promise.all([
        deps.getCatalogPricesByIds(priceIds),
        input.clientId ? deps.getClientSubscriptionSnapshots(input.clientId) : Promise.resolve([]),
      ]);

      return validateCartAgainstCatalog({
        rawLines: input.lines,
        catalogPricesById: new Map(catalogPrices.map((price) => [price.priceId, price])),
        clientSubscriptions: subscriptions,
        now: deps.now(),
      });
    },
  };
}

export async function validateCart(input: CartValidationServiceInput) {
  return createCartValidationService().validate(input);
}

export async function hasActiveSubscriptionForCartConstraint(clientId: string): Promise<boolean> {
  const snapshots = await getClientSubscriptionSnapshots(clientId);
  const now = new Date();
  return snapshots.some((snapshot) => isActiveSubscriptionForCartConstraint(snapshot, now));
}
