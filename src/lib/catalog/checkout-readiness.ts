import { BillingInterval, PriceType, StripeSyncStatus } from "@prisma/client";

type StripeRuntimeMode = "test" | "live" | "unknown";

type CatalogCheckoutReadinessPrice = {
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
};

function resolveStripeRuntimeMode(): StripeRuntimeMode {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (secretKey.startsWith("sk_live_")) {
    return "live";
  }
  if (secretKey.startsWith("sk_test_")) {
    return "test";
  }
  return "unknown";
}

export function isStripePriceIdAllowedForRuntime(
  stripePriceId: string,
  mode: StripeRuntimeMode = resolveStripeRuntimeMode(),
): boolean {
  if (mode === "live" && /^price_test(?:_|$)/.test(stripePriceId)) {
    return false;
  }

  if (mode === "test" && /^price_live(?:_|$)/.test(stripePriceId)) {
    return false;
  }

  return true;
}

export function isCatalogPriceCheckoutReady(
  price: CatalogCheckoutReadinessPrice | null,
  input?: { stripeRuntimeMode?: StripeRuntimeMode },
): boolean {
  if (!price) {
    return false;
  }

  if (!price.stripePriceId || price.stripeSyncStatus !== StripeSyncStatus.SYNCED) {
    return false;
  }

  if (!isStripePriceIdAllowedForRuntime(price.stripePriceId, input?.stripeRuntimeMode)) {
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
