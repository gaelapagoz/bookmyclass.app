import { BillingInterval, PriceType, StripeSyncStatus } from "@prisma/client";

type CatalogCheckoutReadinessPrice = {
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
};

export function isCatalogPriceCheckoutReady(price: CatalogCheckoutReadinessPrice | null): boolean {
  if (!price) {
    return false;
  }

  if (!price.stripePriceId || price.stripeSyncStatus !== StripeSyncStatus.SYNCED) {
    return false;
  }

  if (!/^[A-Z]{3}$/.test(price.currencyCode)) {
    return false;
  }

  if (!Number.isInteger(price.unitAmountMinor) || price.unitAmountMinor <= 0) {
    return false;
  }

  if (price.priceType === PriceType.RECURRING) {
    return Boolean(
      price.billingInterval &&
        price.billingIntervalCount &&
        Number.isInteger(price.billingIntervalCount) &&
        price.billingIntervalCount > 0,
    );
  }

  return price.billingInterval === null && price.billingIntervalCount === null;
}
