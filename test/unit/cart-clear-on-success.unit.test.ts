/* @vitest-environment jsdom */

import { PriceType, ProductType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CART_STORAGE_KEY,
  getCheckoutSubmissionFingerprint,
  maybeClearClientCartAfterConfirmedCheckout,
  rememberClientCartSnapshotForCheckoutSession,
  writeClientCart,
  type ClientCartLine,
} from "../../src/lib/cart/cart-client";

function makeGiftCardLine(overrides: Partial<Pick<ClientCartLine, "productId" | "priceId" | "quantity">> = {}): ClientCartLine {
  return {
    productId: overrides.productId ?? "prod_gc_1",
    priceId: overrides.priceId ?? "price_gc_1",
    productName: "Gift Card 25 EUR",
    productDescription: null,
    productType: ProductType.GIFT_CARD,
    priceName: "€25",
    priceType: PriceType.ONE_TIME,
    quantity: overrides.quantity ?? 1,
    unitAmountMinor: 2500,
    currencyCode: "EUR",
    billingInterval: null,
    billingIntervalCount: null,
  };
}

function readStoredLines(): ClientCartLine[] {
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { lines: ClientCartLine[] };
  return parsed.lines ?? [];
}

describe("cart clear after successful checkout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears purchased Store cart lines after Stripe checkout success (session_id path)", () => {
    const line = makeGiftCardLine();
    writeClientCart([line]);
    const fingerprint = getCheckoutSubmissionFingerprint([line]);
    const sessionId = "cs_test_stripe_success";
    rememberClientCartSnapshotForCheckoutSession({ checkoutSessionId: sessionId, fingerprint });

    const cleared = maybeClearClientCartAfterConfirmedCheckout({
      checkoutSessionId: sessionId,
      cartClearEligible: true,
      purchasedLines: [{ productId: line.productId, priceId: line.priceId, quantity: line.quantity }],
    });

    expect(cleared).toBe(true);
    expect(readStoredLines()).toHaveLength(0);
  });

  it("clears purchased Store cart lines after full-wallet checkout success (orderId path)", () => {
    const line = makeGiftCardLine();
    writeClientCart([line]);
    const fingerprint = getCheckoutSubmissionFingerprint([line]);
    const orderId = "order_fullwallet_abc123";
    rememberClientCartSnapshotForCheckoutSession({ checkoutSessionId: orderId, fingerprint });

    const cleared = maybeClearClientCartAfterConfirmedCheckout({
      checkoutSessionId: orderId,
      cartClearEligible: true,
      purchasedLines: [{ productId: line.productId, priceId: line.priceId, quantity: line.quantity }],
    });

    expect(cleared).toBe(true);
    expect(readStoredLines()).toHaveLength(0);
  });

  it("does not clear cart when cartClearEligible is false (checkout failure or cancel)", () => {
    const line = makeGiftCardLine();
    writeClientCart([line]);
    const fingerprint = getCheckoutSubmissionFingerprint([line]);
    const sessionId = "cs_test_failed";
    rememberClientCartSnapshotForCheckoutSession({ checkoutSessionId: sessionId, fingerprint });

    const cleared = maybeClearClientCartAfterConfirmedCheckout({
      checkoutSessionId: sessionId,
      cartClearEligible: false,
      purchasedLines: [{ productId: line.productId, priceId: line.priceId, quantity: line.quantity }],
    });

    expect(cleared).toBe(false);
    expect(readStoredLines()).toHaveLength(1);
  });
});
