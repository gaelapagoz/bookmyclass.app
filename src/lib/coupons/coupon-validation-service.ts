import {
  Prisma,
  CouponRedemptionStatus,
  type CouponDiscountType,
  type CouponStatus,
} from "@prisma/client";

import type { CartPricingSummary, CartRepricedLine } from "@/lib/cart/cart-types";
import { prisma } from "@/lib/db";
import {
  assertCouponEligibilityForSlice1A,
  buildCouponPayloadHash,
  buildCouponRedemptionIdempotencyKey,
  calculateCouponDiscount,
  canRedeemCouponByLimits,
  isCouponUsableNow,
  normalizeCouponCode,
} from "@/lib/coupons/coupon-primitives";

export type CartCouponPricedLine = CartRepricedLine & {
  couponEligible: boolean;
  lineDiscountAmountMinor: number;
  lineTotalAmountMinor: number;
};

export type CartCheckoutPricing = {
  subtotalAmountMinor: number;
  discountAmountMinor: number;
  totalAmountMinor: number;
  currencyCode: string;
  coupon:
    | null
    | {
        couponId: string;
        couponCode: string;
        discountType: CouponDiscountType;
      };
  pricedLines: CartCouponPricedLine[];
};

export type ResolveCartCouponPricingResult =
  | {
      ok: true;
      pricing: CartCheckoutPricing;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
    };

type CouponWriteClient = Prisma.TransactionClient | typeof prisma;

type CouponValidationRecord = {
  id: string;
  code: string;
  status: CouponStatus;
  discountType: CouponDiscountType;
  discountPercentBps: number | null;
  discountAmountMinor: number | null;
  currencyCode: string | null;
  startsAt: Date | null;
  expiresAt: Date;
  minOrderAmountMinor: number | null;
  maxTotalRedemptions: number | null;
  maxRedemptionsPerClient: number | null;
  eligibilities: Array<{
    productId: string | null;
    priceId: string | null;
  }>;
};

function createBasePricing(input: {
  pricing: CartPricingSummary;
  repricedLines: CartRepricedLine[];
}): CartCheckoutPricing {
  return {
    subtotalAmountMinor: input.pricing.subtotalAmountMinor,
    discountAmountMinor: 0,
    totalAmountMinor: input.pricing.subtotalAmountMinor,
    currencyCode: input.pricing.currencyCode,
    coupon: null,
    pricedLines: input.repricedLines.map((line) => ({
      ...line,
      couponEligible: false,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: line.lineSubtotalAmountMinor,
    })),
  };
}

function matchesCouponEligibility(input: {
  eligibilities: CouponValidationRecord["eligibilities"];
  line: CartRepricedLine;
}): boolean {
  if (input.eligibilities.length === 0) {
    return true;
  }

  return input.eligibilities.some(
    (eligibility) =>
      eligibility.priceId === input.line.priceId || eligibility.productId === input.line.productId,
  );
}

function allocateDiscountAcrossLines(input: {
  lines: CartRepricedLine[];
  totalDiscountAmountMinor: number;
  eligibilities: CouponValidationRecord["eligibilities"];
}): CartCouponPricedLine[] {
  const eligibleIndexes: number[] = [];
  let eligibleSubtotalMinor = 0;

  const pricedLines: CartCouponPricedLine[] = input.lines.map((line, index) => {
    let couponEligible = false;
    try {
      assertCouponEligibilityForSlice1A({
        priceType: line.priceType,
        productType: line.productType,
      });
      couponEligible = matchesCouponEligibility({
        eligibilities: input.eligibilities,
        line,
      });
    } catch {
      couponEligible = false;
    }

    if (couponEligible) {
      eligibleIndexes.push(index);
      eligibleSubtotalMinor += line.lineSubtotalAmountMinor;
    }

    return {
      ...line,
      couponEligible,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: line.lineSubtotalAmountMinor,
    };
  });

  if (eligibleIndexes.length === 0 || input.totalDiscountAmountMinor <= 0 || eligibleSubtotalMinor <= 0) {
    return pricedLines;
  }

  let remainingDiscountMinor = input.totalDiscountAmountMinor;

  for (const [position, lineIndex] of eligibleIndexes.entries()) {
    const line = pricedLines[lineIndex]!;
    const isLastEligibleLine = position === eligibleIndexes.length - 1;
    const lineDiscountAmountMinor = isLastEligibleLine
      ? remainingDiscountMinor
      : Math.min(
          remainingDiscountMinor,
          Math.floor(
            (input.totalDiscountAmountMinor * line.lineSubtotalAmountMinor) / eligibleSubtotalMinor,
          ),
        );

    line.lineDiscountAmountMinor = lineDiscountAmountMinor;
    line.lineTotalAmountMinor = line.lineSubtotalAmountMinor - lineDiscountAmountMinor;
    remainingDiscountMinor -= lineDiscountAmountMinor;
  }

  return pricedLines;
}

async function getCouponByNormalizedCode(code: string): Promise<CouponValidationRecord | null> {
  return prisma.coupon.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      status: true,
      discountType: true,
      discountPercentBps: true,
      discountAmountMinor: true,
      currencyCode: true,
      startsAt: true,
      expiresAt: true,
      minOrderAmountMinor: true,
      maxTotalRedemptions: true,
      maxRedemptionsPerClient: true,
      eligibilities: {
        select: {
          productId: true,
          priceId: true,
        },
      },
    },
  });
}

function buildCouponRedemptionLimitWhere(input: {
  couponId: string;
  clientId?: string;
  now: Date;
}) {
  return {
    couponId: input.couponId,
    ...(input.clientId ? { clientId: input.clientId } : {}),
    OR: [
      { status: CouponRedemptionStatus.APPLIED },
      {
        status: CouponRedemptionStatus.RESERVED,
        expiresAt: { gt: input.now },
      },
    ],
  };
}

export async function reserveCouponRedemptionForCartCheckout(input: {
  tx: Prisma.TransactionClient;
  coupon: NonNullable<CartCheckoutPricing["coupon"]>;
  clientId: string;
  orderId: string;
  paymentId: string | null;
  pricing: CartCheckoutPricing;
  idempotencyKey: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      redemptionId: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
    }
> {
  const now = input.now ?? new Date();
  const reservationExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const couponRedemptionIdempotencyKey = buildCouponRedemptionIdempotencyKey({
    couponId: input.coupon.couponId,
    clientId: input.clientId,
    orderId: input.orderId,
    attempt: input.idempotencyKey,
  });

  await input.tx.$queryRaw`
    SELECT id
    FROM "Coupon"
    WHERE id = ${input.coupon.couponId}
    FOR UPDATE
  `;

  const existingRedemption = await input.tx.couponRedemption.findUnique({
    where: {
      idempotencyKey: couponRedemptionIdempotencyKey,
    },
    select: {
      id: true,
      status: true,
    },
  });

  const expiredRedemptionId =
    existingRedemption?.status === CouponRedemptionStatus.EXPIRED ? existingRedemption.id : null;

  if (existingRedemption) {
    if (existingRedemption.status === CouponRedemptionStatus.REVERSED) {
      const updated = await input.tx.couponRedemption.update({
        where: {
          id: existingRedemption.id,
        },
        data: {
          paymentId: input.paymentId,
          status: CouponRedemptionStatus.RESERVED,
          reservedAt: now,
          expiresAt: reservationExpiresAt,
          appliedAt: null,
          reversedAt: null,
          failureReason: null,
          stripeCheckoutSessionId: null,
        },
        select: {
          id: true,
        },
      });

      return {
        ok: true,
        redemptionId: updated.id,
      };
    }

    if (existingRedemption.status !== CouponRedemptionStatus.RESERVED) {
      if (existingRedemption.status === CouponRedemptionStatus.EXPIRED) {
        // Let expired attempts fall through to fresh coupon validation below.
      } else {
        return {
          ok: true,
          redemptionId: existingRedemption.id,
        };
      }
    } else {
      const updated = await input.tx.couponRedemption.update({
        where: {
          id: existingRedemption.id,
        },
        data: {
          paymentId: input.paymentId,
          reservedAt: now,
          expiresAt: reservationExpiresAt,
        },
        select: {
          id: true,
        },
      });

      return {
        ok: true,
        redemptionId: updated.id,
      };
    }
  }

  const coupon = await input.tx.coupon.findUnique({
    where: { id: input.coupon.couponId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      expiresAt: true,
      maxTotalRedemptions: true,
      maxRedemptionsPerClient: true,
    },
  });

  if (!coupon) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_NOT_FOUND",
      message: "Coupon code was not found.",
    };
  }

  if (
    !isCouponUsableNow({
      now,
      status: coupon.status,
      startsAt: coupon.startsAt,
      expiresAt: coupon.expiresAt,
    })
  ) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_NOT_ACTIVE",
      message: "Coupon is inactive, expired, or not available yet.",
    };
  }

  const [appliedOrReservedTotalCount, appliedOrReservedClientCount] = await Promise.all([
    input.tx.couponRedemption.count({
      where: buildCouponRedemptionLimitWhere({
        couponId: input.coupon.couponId,
        now,
      }),
    }),
    input.tx.couponRedemption.count({
      where: buildCouponRedemptionLimitWhere({
        couponId: input.coupon.couponId,
        clientId: input.clientId,
        now,
      }),
    }),
  ]);

  if (
    !canRedeemCouponByLimits({
      maxTotalRedemptions: coupon.maxTotalRedemptions,
      maxRedemptionsPerClient: coupon.maxRedemptionsPerClient,
      appliedOrReservedTotalCount,
      appliedOrReservedClientCount,
    })
  ) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_USAGE_LIMIT_REACHED",
      message: "Coupon usage limit has been reached.",
    };
  }

  const created = expiredRedemptionId
    ? await input.tx.couponRedemption.update({
        where: {
          id: expiredRedemptionId,
        },
        data: {
          paymentId: input.paymentId,
          status: CouponRedemptionStatus.RESERVED,
          couponCodeSnapshot: input.coupon.couponCode,
          subtotalBeforeMinor: input.pricing.subtotalAmountMinor,
          discountAmountMinor: input.pricing.discountAmountMinor,
          totalAfterMinor: input.pricing.totalAmountMinor,
          currencyCode: input.pricing.currencyCode,
          payloadHash: buildCouponPayloadHash({
            couponId: input.coupon.couponId,
            couponCode: input.coupon.couponCode,
            orderId: input.orderId,
            totalAfterMinor: input.pricing.totalAmountMinor,
          }),
          reservedAt: now,
          expiresAt: reservationExpiresAt,
          appliedAt: null,
          reversedAt: null,
          failureReason: null,
          stripeCheckoutSessionId: null,
        },
        select: {
          id: true,
        },
      })
    : await input.tx.couponRedemption.create({
        data: {
          couponId: input.coupon.couponId,
          clientId: input.clientId,
          orderId: input.orderId,
          paymentId: input.paymentId,
          status: CouponRedemptionStatus.RESERVED,
          couponCodeSnapshot: input.coupon.couponCode,
          subtotalBeforeMinor: input.pricing.subtotalAmountMinor,
          discountAmountMinor: input.pricing.discountAmountMinor,
          totalAfterMinor: input.pricing.totalAmountMinor,
          currencyCode: input.pricing.currencyCode,
          idempotencyKey: couponRedemptionIdempotencyKey,
          payloadHash: buildCouponPayloadHash({
            couponId: input.coupon.couponId,
            couponCode: input.coupon.couponCode,
            orderId: input.orderId,
            totalAfterMinor: input.pricing.totalAmountMinor,
          }),
          reservedAt: now,
          expiresAt: reservationExpiresAt,
        },
        select: {
          id: true,
        },
      });

  return {
    ok: true,
    redemptionId: created.id,
  };
}

export async function updateCouponRedemptionReferencesForCartCheckout(input: {
  coupon: NonNullable<CartCheckoutPricing["coupon"]>;
  clientId: string;
  orderId: string;
  idempotencyKey: string;
  paymentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const db: CouponWriteClient = input.tx ?? prisma;
  const couponRedemptionIdempotencyKey = buildCouponRedemptionIdempotencyKey({
    couponId: input.coupon.couponId,
    clientId: input.clientId,
    orderId: input.orderId,
    attempt: input.idempotencyKey,
  });

  await db.couponRedemption.updateMany({
    where: {
      idempotencyKey: couponRedemptionIdempotencyKey,
    },
    data: {
      ...(input.paymentId !== undefined ? { paymentId: input.paymentId } : {}),
      ...(input.stripeCheckoutSessionId !== undefined
        ? { stripeCheckoutSessionId: input.stripeCheckoutSessionId }
        : {}),
    },
  });
}

export async function settleCouponRedemptionForCartCheckout(input: {
  nextStatus: Extract<CouponRedemptionStatus, "APPLIED" | "EXPIRED" | "REVERSED">;
  orderId?: string | null;
  paymentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  failureReason?: string | null;
  tx?: Prisma.TransactionClient;
  now?: Date;
}): Promise<number> {
  const db: CouponWriteClient = input.tx ?? prisma;
  const now = input.now ?? new Date();
  const orFilters: Array<
    | { orderId: string }
    | { paymentId: string }
    | { stripeCheckoutSessionId: string }
  > = [];

  if (input.orderId) {
    orFilters.push({ orderId: input.orderId });
  }
  if (input.paymentId) {
    orFilters.push({ paymentId: input.paymentId });
  }
  if (input.stripeCheckoutSessionId) {
    orFilters.push({ stripeCheckoutSessionId: input.stripeCheckoutSessionId });
  }

  if (orFilters.length === 0) {
    return 0;
  }

  const reservedRows = await db.couponRedemption.findMany({
    where: {
      status: CouponRedemptionStatus.RESERVED,
      OR: orFilters,
    },
    select: {
      id: true,
    },
  });

  if (reservedRows.length === 0) {
    return 0;
  }

  const result = await db.couponRedemption.updateMany({
    where: {
      id: {
        in: reservedRows.map((row) => row.id),
      },
      status: CouponRedemptionStatus.RESERVED,
    },
    data: {
      status: input.nextStatus,
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      ...(input.stripeCheckoutSessionId ? { stripeCheckoutSessionId: input.stripeCheckoutSessionId } : {}),
      ...(input.nextStatus === CouponRedemptionStatus.APPLIED
        ? {
            appliedAt: now,
            failureReason: null,
          }
        : {}),
      ...(input.nextStatus === CouponRedemptionStatus.REVERSED
        ? {
            reversedAt: now,
            failureReason: input.failureReason ?? null,
          }
        : {}),
      ...(input.nextStatus === CouponRedemptionStatus.EXPIRED
        ? {
            failureReason: input.failureReason ?? "Checkout session expired.",
          }
        : {}),
    },
  });

  return result.count;
}

export async function resolveCartCouponPricing(input: {
  userId: string;
  couponCode?: string | null;
  repricedLines: CartRepricedLine[];
  pricing: CartPricingSummary;
  now?: Date;
}): Promise<ResolveCartCouponPricingResult> {
  const basePricing = createBasePricing({
    pricing: input.pricing,
    repricedLines: input.repricedLines,
  });
  const rawCouponCode = input.couponCode?.trim() ?? "";

  if (!rawCouponCode) {
    return { ok: true, pricing: basePricing };
  }

  let normalizedCouponCode: string;
  try {
    normalizedCouponCode = normalizeCouponCode(rawCouponCode);
  } catch {
    return {
      ok: false,
      status: 422,
      code: "COUPON_CODE_INVALID",
      message: "Coupon code format is invalid.",
    };
  }

  const coupon = await getCouponByNormalizedCode(normalizedCouponCode);
  if (!coupon) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_NOT_FOUND",
      message: "Coupon code was not found.",
    };
  }

  const now = input.now ?? new Date();
  if (
    !isCouponUsableNow({
      now,
      status: coupon.status,
      startsAt: coupon.startsAt,
      expiresAt: coupon.expiresAt,
    })
  ) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_NOT_ACTIVE",
      message: "Coupon is inactive, expired, or not available yet.",
    };
  }

  if (input.repricedLines.some((line) => line.priceType !== "ONE_TIME")) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_RECURRING_NOT_SUPPORTED",
      message:
        "Coupons are not available for recurring memberships yet. Remove the coupon or choose a one-time product.",
    };
  }

  if (coupon.minOrderAmountMinor !== null && input.pricing.subtotalAmountMinor < coupon.minOrderAmountMinor) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_MIN_ORDER_NOT_MET",
      message: "Order total does not meet the coupon minimum amount.",
    };
  }

  if (
    coupon.discountType === "FIXED_AMOUNT" &&
    coupon.currencyCode &&
    coupon.currencyCode !== input.pricing.currencyCode
  ) {
    return {
      ok: false,
      status: 422,
      code: "COUPON_CURRENCY_MISMATCH",
      message: "Coupon currency does not match the cart currency.",
    };
  }

  const eligibleLines = input.repricedLines.filter((line) => {
    try {
      assertCouponEligibilityForSlice1A({
        priceType: line.priceType,
        productType: line.productType,
      });
      return matchesCouponEligibility({
        eligibilities: coupon.eligibilities,
        line,
      });
    } catch {
      return false;
    }
  });

  const eligibleSubtotalMinor = eligibleLines.reduce(
    (sum, line) => sum + line.lineSubtotalAmountMinor,
    0,
  );

  if (eligibleSubtotalMinor <= 0) {
    const hasGiftCardOnlyCart =
      input.repricedLines.length > 0 &&
      input.repricedLines.every((line) => line.productType === "GIFT_CARD");

    return {
      ok: false,
      status: 422,
      code: hasGiftCardOnlyCart ? "COUPON_GIFT_CARD_NOT_SUPPORTED" : "COUPON_NOT_ELIGIBLE",
      message: hasGiftCardOnlyCart
        ? "Coupons cannot be used for gift-card purchases."
        : "Coupon is not eligible for the selected cart items.",
    };
  }

  let discountAmountMinor: number;
  try {
    discountAmountMinor = calculateCouponDiscount({
      discountType: coupon.discountType,
      discountPercentBps: coupon.discountPercentBps,
      discountAmountMinor: coupon.discountAmountMinor,
      eligibleSubtotalMinor,
    });
  } catch {
    return {
      ok: false,
      status: 422,
      code: "COUPON_INVALID",
      message: "Coupon configuration is invalid.",
    };
  }

  const pricedLines = allocateDiscountAcrossLines({
    lines: input.repricedLines,
    totalDiscountAmountMinor: discountAmountMinor,
    eligibilities: coupon.eligibilities,
  });

  return {
    ok: true,
    pricing: {
      subtotalAmountMinor: input.pricing.subtotalAmountMinor,
      discountAmountMinor,
      totalAmountMinor: Math.max(0, input.pricing.subtotalAmountMinor - discountAmountMinor),
      currencyCode: input.pricing.currencyCode,
      coupon: {
        couponId: coupon.id,
        couponCode: coupon.code,
        discountType: coupon.discountType,
      },
      pricedLines,
    },
  };
}
