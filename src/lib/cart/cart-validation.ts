import { PriceType } from "@prisma/client";
import { computeCartHash, buildCartHashCanonicalInput } from "@/lib/cart/cart-hash";
import { createCartValidationRejection } from "@/lib/cart/cart-policy";
import {
  isActiveSubscriptionForCartConstraint,
} from "@/lib/cart/cart-contract";
import type {
  CartComposition,
  CartNormalizedLine,
  CartPricingSummary,
  CartRepricedLine,
  CartResolvedCatalogPrice,
  CartValidationResult,
  CartSubscriptionSnapshot,
} from "@/lib/cart/cart-types";

function resolveComposition(lines: Pick<CartRepricedLine, "priceType">[]): CartComposition {
  if (lines.length === 0) {
    return "EMPTY";
  }

  const hasRecurring = lines.some((line) => line.priceType === PriceType.RECURRING);
  const hasOneTime = lines.some((line) => line.priceType === PriceType.ONE_TIME);

  if (hasRecurring && hasOneTime) {
    return "EMPTY";
  }

  return hasRecurring ? "RECURRING_ONLY" : "ONE_TIME_ONLY";
}

function isActivePriceWindow(input: {
  now: Date;
  startsAt: Date | null;
  endsAt: Date | null;
}): boolean {
  if (input.startsAt && input.startsAt.getTime() > input.now.getTime()) {
    return false;
  }

  if (input.endsAt && input.endsAt.getTime() <= input.now.getTime()) {
    return false;
  }

  return true;
}

function toRepricedLine(input: {
  line: CartNormalizedLine;
  catalogPrice: CartResolvedCatalogPrice;
}): CartRepricedLine {
  return {
    productId: input.line.productId,
    priceId: input.line.priceId,
    productName: input.catalogPrice.productName,
    productDescription: input.catalogPrice.productDescription,
    productType: input.catalogPrice.productType,
    priceName: input.catalogPrice.priceName,
    priceType: input.catalogPrice.priceType,
    quantity: input.line.quantity,
    unitAmountMinor: input.catalogPrice.unitAmountMinor,
    lineSubtotalAmountMinor: input.catalogPrice.unitAmountMinor * input.line.quantity,
    currencyCode: input.catalogPrice.currencyCode,
    billingInterval: input.catalogPrice.billingInterval,
    billingIntervalCount: input.catalogPrice.billingIntervalCount,
  };
}

function summarizePricing(lines: CartRepricedLine[]): CartPricingSummary {
  if (lines.length === 0) {
    return {
      subtotalAmountMinor: 0,
      currencyCode: "EUR",
    };
  }

  const firstCurrency = lines[0]?.currencyCode ?? "EUR";
  const subtotalAmountMinor = lines.reduce((sum, line) => sum + line.lineSubtotalAmountMinor, 0);
  return {
    subtotalAmountMinor,
    currencyCode: firstCurrency,
  };
}

function hasAnyActiveSubscription(input: {
  snapshots: CartSubscriptionSnapshot[];
  now: Date;
}): boolean {
  return input.snapshots.some((snapshot) => isActiveSubscriptionForCartConstraint(snapshot, input.now));
}

export function validateCartAgainstCatalog(input: {
  rawLines: Array<{ productId: string; priceId: string; quantity: number }>;
  catalogPricesById: Map<string, CartResolvedCatalogPrice>;
  clientSubscriptions: CartSubscriptionSnapshot[];
  now: Date;
}): CartValidationResult {
  const canonical = buildCartHashCanonicalInput(input.rawLines);
  const cartHash = computeCartHash(input.rawLines);
  const normalizedLines: CartNormalizedLine[] = canonical.normalizedLines.map((line) => ({
    productId: line.productId,
    priceId: line.priceId,
    quantity: line.quantity,
  }));

  if (normalizedLines.length === 0) {
    return {
      ok: false,
      composition: "EMPTY",
      cartHash,
      normalizedLines,
      rejection: createCartValidationRejection("EMPTY_CART"),
    };
  }

  const repricedLines: CartRepricedLine[] = [];

  for (const line of normalizedLines) {
    const catalogPrice = input.catalogPricesById.get(line.priceId);

    if (!catalogPrice || catalogPrice.productId !== line.productId) {
      return {
        ok: false,
        composition: "EMPTY",
        cartHash,
        normalizedLines,
        rejection: createCartValidationRejection("PRICE_NOT_ACTIVE"),
      };
    }

    if (!catalogPrice.productIsActive || catalogPrice.productIsArchived) {
      return {
        ok: false,
        composition: "EMPTY",
        cartHash,
        normalizedLines,
        rejection: createCartValidationRejection("PRODUCT_NOT_ACTIVE"),
      };
    }

    if (
      !catalogPrice.priceIsActive ||
      catalogPrice.priceIsArchived ||
      !isActivePriceWindow({
        now: input.now,
        startsAt: catalogPrice.priceStartsAt,
        endsAt: catalogPrice.priceEndsAt,
      })
    ) {
      return {
        ok: false,
        composition: "EMPTY",
        cartHash,
        normalizedLines,
        rejection: createCartValidationRejection("PRICE_NOT_ACTIVE"),
      };
    }

    if (!catalogPrice.checkoutEnabled) {
      return {
        ok: false,
        composition: "EMPTY",
        cartHash,
        normalizedLines,
        rejection: createCartValidationRejection("CHECKOUT_NOT_ENABLED"),
      };
    }

    if (catalogPrice.priceType === PriceType.RECURRING && line.quantity !== 1) {
      return {
        ok: false,
        composition: "EMPTY",
        cartHash,
        normalizedLines,
        rejection: createCartValidationRejection("RECURRING_QUANTITY_MUST_BE_ONE"),
      };
    }

    repricedLines.push(
      toRepricedLine({
        line,
        catalogPrice,
      }),
    );
  }

  const hasRecurring = repricedLines.some((line) => line.priceType === PriceType.RECURRING);
  const hasOneTime = repricedLines.some((line) => line.priceType === PriceType.ONE_TIME);
  if (hasRecurring && hasOneTime) {
    return {
      ok: false,
      composition: "EMPTY",
      cartHash,
      normalizedLines,
      rejection: createCartValidationRejection("MIXED_PRICE_TYPES_NOT_ALLOWED"),
    };
  }

  if (
    hasRecurring &&
    hasAnyActiveSubscription({
      snapshots: input.clientSubscriptions,
      now: input.now,
    })
  ) {
    return {
      ok: false,
      composition: "RECURRING_ONLY",
      cartHash,
      normalizedLines,
      rejection: createCartValidationRejection("ACTIVE_SUBSCRIPTION_ALREADY_EXISTS"),
    };
  }

  return {
    ok: true,
    composition: resolveComposition(repricedLines),
    cartHash,
    normalizedLines,
    repricedLines,
    pricing: summarizePricing(repricedLines),
  };
}
