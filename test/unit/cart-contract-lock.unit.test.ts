import { describe, expect, it } from "vitest";
import { SubscriptionStatus } from "@prisma/client";

import {
  CART_CHECKOUT_DETERMINISTIC_FAILURE_STATUS_CODES,
  CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX,
  CART_CHECKOUT_IDEMPOTENCY_STATES,
  CART_CHECKOUT_SOURCE,
  isActiveSubscriptionForCartConstraint,
} from "../../src/lib/cart/cart-contract";
import { buildCartHashCanonicalInput, computeCartHash } from "../../src/lib/cart/cart-hash";

describe("cart contract lock", () => {
  it("defines the canonical cart checkout source marker", () => {
    expect(CART_CHECKOUT_SOURCE).toBe("CART_CHECKOUT_V1");
  });

  it("defines all required idempotency states", () => {
    expect(CART_CHECKOUT_IDEMPOTENCY_STATES).toEqual({
      IN_PROGRESS: "IN_PROGRESS",
      SUCCEEDED: "SUCCEEDED",
      FAILED_BEFORE_WRITE: "FAILED_BEFORE_WRITE",
      FAILED_AFTER_WRITE_PRE_STRIPE: "FAILED_AFTER_WRITE_PRE_STRIPE",
      FAILED_STRIPE_UNCERTAIN: "FAILED_STRIPE_UNCERTAIN",
    });
  });

  it("defines deterministic replay status codes exactly", () => {
    expect(CART_CHECKOUT_DETERMINISTIC_FAILURE_STATUS_CODES).toEqual([400, 401, 403, 409, 422]);
  });

  it("enforces idempotency key format", () => {
    expect(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX.test("cartchk_123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX.test("cartchk_abc")).toBe(false);
    expect(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX.test("other_123e4567-e89b-12d3-a456-426614174000")).toBe(false);
  });

  it("applies active-subscription predicate exactly to ACTIVE + time window", () => {
    const asOf = new Date("2026-04-19T10:00:00.000Z");

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date("2026-04-19T10:00:01.000Z"),
          endedAt: null,
        },
        asOf,
      ),
    ).toBe(true);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date("2026-04-19T10:00:00.000Z"),
          endedAt: null,
        },
        asOf,
      ),
    ).toBe(false);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.PENDING,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: null,
        },
        asOf,
      ),
    ).toBe(false);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.CANCELLED,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: null,
        },
        asOf,
      ),
    ).toBe(false);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.EXPIRED,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: null,
        },
        asOf,
      ),
    ).toBe(false);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: null,
        },
        asOf,
      ),
    ).toBe(false);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: new Date("2026-04-19T10:00:00.000Z"),
        },
        asOf,
      ),
    ).toBe(false);

    expect(
      isActiveSubscriptionForCartConstraint(
        {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date("2026-04-20T10:00:00.000Z"),
          endedAt: new Date("2026-04-19T09:00:00.000Z"),
        },
        asOf,
      ),
    ).toBe(false);
  });

  it("builds canonical payload using sorted and deduplicated line order", () => {
    const canonical = buildCartHashCanonicalInput([
      { productId: "prod_B", priceId: "price_2", quantity: 1 },
      { productId: "prod_A", priceId: "price_1", quantity: 2 },
      { productId: "prod_A", priceId: "price_1", quantity: 3 },
    ]);

    expect(canonical.normalizedLines).toEqual([
      { productId: "prod_A", priceId: "price_1", quantity: 5 },
      { productId: "prod_B", priceId: "price_2", quantity: 1 },
    ]);
    expect(canonical.canonicalPayload).toBe(
      "version=CART_HASH_V1|lineCount=2|lines=productId=prod_A,priceId=price_1,quantity=5;productId=prod_B,priceId=price_2,quantity=1",
    );
  });

  it("uses locale-independent lexical ordering for canonical lines", () => {
    const canonical = buildCartHashCanonicalInput([
      { productId: "ä", priceId: "price_2", quantity: 1 },
      { productId: "z", priceId: "price_1", quantity: 1 },
    ]);

    expect(canonical.normalizedLines).toEqual([
      { productId: "z", priceId: "price_1", quantity: 1 },
      { productId: "ä", priceId: "price_2", quantity: 1 },
    ]);
  });

  it("normalizes trimmed identifiers to equivalent hash and deduped lines", () => {
    const canonical = buildCartHashCanonicalInput([
      { productId: "prod_A", priceId: "price_1", quantity: 1 },
      { productId: " prod_A ", priceId: " price_1 ", quantity: 2 },
    ]);

    expect(canonical.normalizedLines).toEqual([{ productId: "prod_A", priceId: "price_1", quantity: 3 }]);

    const clean = computeCartHash([{ productId: "prod_A", priceId: "price_1", quantity: 3 }]);
    const withWhitespace = computeCartHash([{ productId: " prod_A ", priceId: " price_1 ", quantity: 3 }]);
    expect(clean).toBe(withWhitespace);
  });

  it("serializes delimiter and special characters using URI encoding", () => {
    const canonical = buildCartHashCanonicalInput([
      { productId: "prod|A;X,Y% Z", priceId: "price|1;2,3% 4", quantity: 1 },
    ]);

    expect(canonical.canonicalPayload).toBe(
      "version=CART_HASH_V1|lineCount=1|lines=productId=prod%7CA%3BX%2CY%25%20Z,priceId=price%7C1%3B2%2C3%25%204,quantity=1",
    );
  });

  it("defines empty-line-set canonical payload behavior", () => {
    const canonical = buildCartHashCanonicalInput([]);
    expect(canonical.normalizedLines).toEqual([]);
    expect(canonical.canonicalPayload).toBe("version=CART_HASH_V1|lineCount=0|lines=");
    expect(computeCartHash([])).toBe("bd51c4400722e3af3aba92872222f864f22a738aab7cb578004725194a91c988");
  });

  it("produces the same hash across input ordering and non-deterministic extras", () => {
    const first = computeCartHash([
      { productId: "prod_A", priceId: "price_1", quantity: 1 },
      { productId: "prod_B", priceId: "price_2", quantity: 2 },
    ]);

    const second = computeCartHash([
      { productId: "prod_B", priceId: "price_2", quantity: 2 },
      { productId: "prod_A", priceId: "price_1", quantity: 1 },
    ]);

    const third = computeCartHash([
      { productId: "prod_A", priceId: "price_1", quantity: 1, nonce: Date.now() } as unknown as {
        productId: string;
        priceId: string;
        quantity: number;
      },
      { productId: "prod_B", priceId: "price_2", quantity: 2, random: Math.random() } as unknown as {
        productId: string;
        priceId: string;
        quantity: number;
      },
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("rejects non-positive or non-integer quantities for cart hash input", () => {
    expect(() =>
      computeCartHash([{ productId: "prod_A", priceId: "price_1", quantity: 0 }]),
    ).toThrow("Cart quantity must be a positive integer.");
    expect(() =>
      computeCartHash([{ productId: "prod_A", priceId: "price_1", quantity: 1.1 }]),
    ).toThrow("Cart quantity must be a positive integer.");
    expect(() =>
      computeCartHash([{ productId: "prod_A", priceId: "price_1", quantity: Number.MAX_SAFE_INTEGER + 1 }]),
    ).toThrow("Cart quantity must be a positive integer.");
  });
});
