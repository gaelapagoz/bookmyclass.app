import { BillingInterval, PriceType } from "@prisma/client";
import { createHash } from "node:crypto";

type PlanProvisionInput = {
  existingStripeProductId: string | null;
  syncCorrelation: string;
  productName: string;
  productDescription: string | null;
  priceName: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
};

export type PlanProvisionResult =
  | { ok: true; stripeProductId: string; stripePriceId: string }
  | { ok: false; reason: string; stripeErrorCode?: string };

export function buildStripeIdempotencyKey(syncCorrelation: string, operation: string): string {
  const stableHash = createHash("sha256")
    .update(`${syncCorrelation}:${operation}`)
    .digest("hex")
    .slice(0, 32);

  return `catalog-sync:${operation}:${stableHash}`;
}

function toStripeRecurringInterval(interval: BillingInterval): "day" | "week" | "month" | "year" {
  switch (interval) {
    case BillingInterval.DAY:
      return "day";
    case BillingInterval.WEEK:
      return "week";
    case BillingInterval.MONTH:
      return "month";
    case BillingInterval.YEAR:
      return "year";
    default:
      return "month";
  }
}

export async function resolveStripeProductIdFromPrice(stripePriceId: string): Promise<string | null> {
  try {
    const { getStripeClient } = await import("@/lib/payments/stripe");
    const stripePrice = await getStripeClient().prices.retrieve(stripePriceId);
    if (typeof stripePrice.product === "string") {
      return stripePrice.product;
    }

    return stripePrice.product?.id ?? null;
  } catch {
    return null;
  }
}

export async function provisionPlanOnStripe(input: PlanProvisionInput): Promise<PlanProvisionResult> {
  try {
    const { getStripeClient } = await import("@/lib/payments/stripe");
    const stripe = getStripeClient();
    const productIdempotencyOperation = input.existingStripeProductId ? "product-link" : "product-create";

    const stripeProduct = input.existingStripeProductId
      ? await stripe.products.update(input.existingStripeProductId, {
          name: input.productName,
          description: input.productDescription ?? undefined,
          active: true,
        }, {
          idempotencyKey: buildStripeIdempotencyKey(input.syncCorrelation, productIdempotencyOperation),
        })
      : await stripe.products.create({
          name: input.productName,
          description: input.productDescription ?? undefined,
          active: true,
        }, {
          idempotencyKey: buildStripeIdempotencyKey(input.syncCorrelation, productIdempotencyOperation),
        });

    const stripePrice = await stripe.prices.create({
      product: stripeProduct.id,
      currency: input.currencyCode.toLowerCase(),
      unit_amount: input.unitAmountMinor,
      nickname: input.priceName,
      recurring:
        input.priceType === PriceType.RECURRING
          ? {
              interval: toStripeRecurringInterval(input.billingInterval ?? BillingInterval.MONTH),
              interval_count: input.billingIntervalCount ?? 1,
            }
          : undefined,
    }, {
      idempotencyKey: buildStripeIdempotencyKey(input.syncCorrelation, "price-create"),
    });

    return {
      ok: true,
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
    };
  } catch (error) {
    const stripeErrorCode =
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    const reason = error instanceof Error ? error.message : "Unknown Stripe provisioning error";
    return {
      ok: false,
      reason,
      stripeErrorCode,
    };
  }
}
