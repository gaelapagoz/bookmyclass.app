import { BillingInterval, PriceType } from "@prisma/client";

import { getStripeClient } from "@/lib/payments/stripe";

type PlanProvisionInput = {
  existingStripeProductId: string | null;
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
  | { ok: false; reason: string };

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
    const stripe = getStripeClient();

    const stripeProduct = input.existingStripeProductId
      ? await stripe.products.update(input.existingStripeProductId, {
          name: input.productName,
          description: input.productDescription ?? undefined,
          active: true,
        })
      : await stripe.products.create({
          name: input.productName,
          description: input.productDescription ?? undefined,
          active: true,
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
    });

    return {
      ok: true,
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Stripe provisioning error";
    return {
      ok: false,
      reason,
    };
  }
}
