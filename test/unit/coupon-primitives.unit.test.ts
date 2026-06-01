import {
  assertCouponEligibilityForSlice1A,
  buildCouponPayloadHash,
  buildCouponRedemptionIdempotencyKey,
  buildZeroPaymentContract,
  calculateCouponDiscount,
  canRedeemCouponByLimits,
  isCouponUsableNow,
  normalizeCouponCode,
} from "../../src/lib/coupons/coupon-primitives";

describe("coupon primitives", () => {
  it("normalizes valid coupon codes", () => {
    expect(normalizeCouponCode("  spring_15 ")).toBe("SPRING_15");
  });

  it("rejects invalid coupon code format", () => {
    expect(() => normalizeCouponCode("ab")).toThrow("COUPON_CODE_INVALID");
  });

  it("calculates percentage and fixed discounts with subtotal clamp", () => {
    expect(
      calculateCouponDiscount({
        discountType: "PERCENTAGE",
        discountPercentBps: 1500,
        eligibleSubtotalMinor: 10_000,
      }),
    ).toBe(1500);

    expect(
      calculateCouponDiscount({
        discountType: "FIXED_AMOUNT",
        discountAmountMinor: 20_000,
        eligibleSubtotalMinor: 10_000,
      }),
    ).toBe(10_000);
  });

  it("enforces one-time non-gift-card eligibility", () => {
    expect(() =>
      assertCouponEligibilityForSlice1A({
        priceType: "RECURRING",
        productType: "SERVICE",
      }),
    ).toThrow("COUPON_RECURRING_NOT_SUPPORTED");

    expect(() =>
      assertCouponEligibilityForSlice1A({
        priceType: "ONE_TIME",
        productType: "GIFT_CARD",
      }),
    ).toThrow("COUPON_GIFT_CARD_NOT_SUPPORTED");
  });

  it("enforces usage limits against applied+reserved counters", () => {
    expect(
      canRedeemCouponByLimits({
        maxTotalRedemptions: 2,
        maxRedemptionsPerClient: 1,
        appliedOrReservedTotalCount: 2,
        appliedOrReservedClientCount: 0,
      }),
    ).toBe(false);
  });

  it("builds stable idempotency keys and payload hashes", () => {
    const key = buildCouponRedemptionIdempotencyKey({
      couponId: "cp_1",
      clientId: "u_1",
      orderId: "o_1",
      attempt: "attempt-1",
    });
    expect(key).toBe("coupon-redemption:cp_1:u_1:o_1:attempt-1");

    const payloadA = { a: 1, b: "x", nested: { z: 2, y: 1 } };
    const payloadB = { nested: { y: 1, z: 2 }, b: "x", a: 1 };
    expect(buildCouponPayloadHash(payloadA)).toBe(buildCouponPayloadHash(payloadB));
  });

  it("checks active time windows and builds zero-payment contract", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    expect(
      isCouponUsableNow({
        now,
        status: "ACTIVE",
        startsAt: new Date("2026-05-31T00:00:00.000Z"),
        expiresAt: new Date("2026-06-02T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isCouponUsableNow({
        now,
        status: "ACTIVE",
        startsAt: new Date("2026-06-01T12:00:00.000Z"),
        expiresAt: new Date("2026-06-02T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isCouponUsableNow({
        now,
        status: "ACTIVE",
        startsAt: null,
        expiresAt: new Date("2026-06-01T12:00:00.000Z"),
      }),
    ).toBe(false);

    expect(
      buildZeroPaymentContract({
        currencyCode: "EUR",
        checkoutSource: "CART_CHECKOUT_V1",
      }),
    ).toMatchObject({
      status: "SUCCEEDED",
      method: "MANUAL",
      provider: "INTERNAL",
      amountMinor: 0,
      currencyCode: "EUR",
      checkoutSource: "CART_CHECKOUT_V1",
      providerReference: null,
      stripeCheckoutSessionId: null,
    });
  });

  it("rejects invalid discount boundaries", () => {
    expect(() =>
      calculateCouponDiscount({
        discountType: "PERCENTAGE",
        discountPercentBps: 10001,
        eligibleSubtotalMinor: 1000,
      }),
    ).toThrow("COUPON_PERCENT_INVALID");

    expect(() =>
      calculateCouponDiscount({
        discountType: "FIXED_AMOUNT",
        discountAmountMinor: 0,
        eligibleSubtotalMinor: 1000,
      }),
    ).toThrow("COUPON_FIXED_AMOUNT_INVALID");
  });
});
