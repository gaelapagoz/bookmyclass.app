import { createHash } from "node:crypto";

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

export type CouponDiscountType = "PERCENTAGE" | "FIXED_AMOUNT";
export type PriceType = "ONE_TIME" | "RECURRING";
export type ProductType = "GIFT_CARD" | string;
export type CouponRedemptionStatus = "RESERVED" | "APPLIED";

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const next: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      next[k] = sortDeep(v);
    }
    return next;
  }
  return value;
}

export function normalizeCouponCode(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw new Error("COUPON_CODE_INVALID");
  }
  return normalized;
}

export function calculateCouponDiscount(input: {
  discountType: CouponDiscountType;
  discountPercentBps?: number | null;
  discountAmountMinor?: number | null;
  eligibleSubtotalMinor: number;
}): number {
  const eligibleSubtotalMinor = Math.max(0, Math.trunc(input.eligibleSubtotalMinor));
  if (eligibleSubtotalMinor === 0) return 0;

  if (input.discountType === "PERCENTAGE") {
    const bps = Math.trunc(input.discountPercentBps ?? 0);
    if (bps <= 0 || bps > 10_000) throw new Error("COUPON_PERCENT_INVALID");
    return Math.min(eligibleSubtotalMinor, Math.floor((eligibleSubtotalMinor * bps) / 10_000));
  }

  const amount = Math.trunc(input.discountAmountMinor ?? 0);
  if (amount <= 0) throw new Error("COUPON_FIXED_AMOUNT_INVALID");
  return Math.min(eligibleSubtotalMinor, amount);
}

export function assertCouponEligibilityForSlice1A(input: {
  priceType: PriceType;
  productType: ProductType;
}): void {
  if (input.priceType !== "ONE_TIME") {
    throw new Error("COUPON_RECURRING_NOT_SUPPORTED");
  }
  if (input.productType === "GIFT_CARD") {
    throw new Error("COUPON_GIFT_CARD_NOT_SUPPORTED");
  }
}

export function canRedeemCouponByLimits(input: {
  maxTotalRedemptions?: number | null;
  maxRedemptionsPerClient?: number | null;
  appliedOrReservedTotalCount: number;
  appliedOrReservedClientCount: number;
}): boolean {
  const totalMax = input.maxTotalRedemptions ?? null;
  const perClientMax = input.maxRedemptionsPerClient ?? null;

  if (totalMax !== null && input.appliedOrReservedTotalCount >= totalMax) return false;
  if (perClientMax !== null && input.appliedOrReservedClientCount >= perClientMax) return false;
  return true;
}

export function buildCouponRedemptionIdempotencyKey(input: {
  couponId: string;
  clientId: string;
  orderId?: string | null;
  attempt: string;
}): string {
  return [
    "coupon-redemption",
    input.couponId.trim(),
    input.clientId.trim(),
    (input.orderId ?? "none").trim(),
    input.attempt.trim(),
  ].join(":");
}

export function buildCouponPayloadHash(input: unknown): string {
  const canonical = JSON.stringify(sortDeep(input));
  return createHash("sha256").update(canonical).digest("hex");
}

export function isCouponUsableNow(input: {
  now: Date;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  startsAt?: Date | null;
  expiresAt: Date;
}): boolean {
  if (input.status !== "ACTIVE") return false;
  if (input.startsAt && input.startsAt.getTime() > input.now.getTime()) return false;
  return input.expiresAt.getTime() > input.now.getTime();
}

export function buildZeroPaymentContract(input: {
  currencyCode: string;
  checkoutSource: "BOOKING_FLOW" | "SUBSCRIPTION_CATALOG" | "CART_CHECKOUT_V1";
}) {
  return {
    status: "SUCCEEDED" as const,
    method: "MANUAL" as const,
    provider: "INTERNAL" as const,
    amountMinor: 0,
    currencyCode: input.currencyCode,
    checkoutSource: input.checkoutSource,
    providerReference: null,
    stripeCheckoutSessionId: null,
  };
}
