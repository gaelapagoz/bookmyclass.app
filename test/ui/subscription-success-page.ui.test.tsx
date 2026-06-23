/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CART_CHECKOUT_SNAPSHOT_PREFIX,
  CART_CLEARED_SESSION_PREFIX,
  CART_STORAGE_KEY,
} from "@/lib/cart/cart-client";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: "user_1",
    },
  })),
}));

vi.mock("@/lib/public-booking/stripe-webhook-service", () => ({
  reconcileCatalogCheckoutSessionAfterReturn: vi.fn(async () => undefined),
}));

const getCartCheckoutSuccessStateMock = vi.fn();
const getCartCheckoutSuccessStateForOrderMock = vi.fn();

vi.mock("@/lib/cart/cart-success-state", () => ({
  getCartCheckoutSuccessStateForOrder: (...args: unknown[]) =>
    getCartCheckoutSuccessStateForOrderMock(...args),
  getCartCheckoutSuccessState: (...args: unknown[]) => getCartCheckoutSuccessStateMock(...args),
}));

import SubscriptionSuccessPage from "../../src/app/(protected)/subscription/success/page";

describe("Subscription success page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 7,
        lines: [
          {
            productId: "prod_1",
            priceId: "price_1",
            productName: "Cart Pack A",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "Pack A",
            priceType: "ONE_TIME",
            quantity: 1,
            unitAmountMinor: 5000,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
        ],
      }),
    );

    getCartCheckoutSuccessStateMock.mockReset();
    getCartCheckoutSuccessStateForOrderMock.mockReset();
    getCartCheckoutSuccessStateMock.mockResolvedValue({
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      reconciliationState: "CONFIRMED",
      cartClearEligible: true,
      subtotalAmountMinor: 11000,
      discountAmountMinor: 2000,
      totalAmountMinor: 9000,
      totalPaidAmountMinor: 9000,
      stripePaidAmountMinor: 4500,
      currencyCode: "EUR",
      couponCodeSnapshot: "SAVE20",
      loyaltyCreditAmountMinor: 1500,
      walletAmountMinor: 3000,
      stripeCheckoutSessionId: "cs_test_123",
      hasZeroValuePayment: false,
      items: [
        {
          productId: "prod_1",
          priceId: "price_1",
          productNameSnapshot: "Cart Pack A",
          priceNameSnapshot: "Pack A",
          quantity: 1,
          unitAmountMinor: 5000,
          lineTotalAmountMinor: 5000,
          currencyCode: "EUR",
        },
        {
          productId: "prod_2",
          priceId: "price_2",
          productNameSnapshot: "Cart Pack B",
          priceNameSnapshot: "Pack B",
          quantity: 2,
          unitAmountMinor: 3000,
          lineTotalAmountMinor: 6000,
          currencyCode: "EUR",
        },
      ],
    });
  });

  it("renders DB-backed order summary and confirmed clear eligibility", async () => {
    const checkoutSessionId = "cs_test_123";
    window.localStorage.setItem(
      `${CART_CHECKOUT_SNAPSHOT_PREFIX}${checkoutSessionId}`,
      "prod_1:price_1:1",
    );
    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: checkoutSessionId,
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Payment Confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Order Summary")).toBeInTheDocument();
    expect(screen.getByText("Cart Pack A")).toBeInTheDocument();
    expect(screen.getByText("Pack B")).toBeInTheDocument();
    expect(screen.getByText("SUCCEEDED")).toBeInTheDocument();
    expect(screen.getByText("PAID")).toBeInTheDocument();
    expect(screen.getByText("CONFIRMED")).toBeInTheDocument();
    expect(screen.queryByText("Cart Clear Eligible")).not.toBeInTheDocument();
    expect(screen.getByText("Subtotal:")).toBeInTheDocument();
    expect(screen.getByText("€110.00")).toBeInTheDocument();
    expect(screen.getByText("Coupon (SAVE20):")).toBeInTheDocument();
    expect(screen.getByText("-€20.00")).toBeInTheDocument();
    expect(screen.getByText("Loyalty Credit:")).toBeInTheDocument();
    expect(screen.getByText("-€15.00")).toBeInTheDocument();
    expect(screen.getByText("Gift Card Wallet:")).toBeInTheDocument();
    expect(screen.getByText("-€30.00")).toBeInTheDocument();
    expect(screen.getByText("Stripe/Card Remainder:")).toBeInTheDocument();
    expect(screen.getByText("€45.00")).toBeInTheDocument();
    expect(screen.getByText("Order Total:")).toBeInTheDocument();
    expect(screen.getAllByText("€90.00")).toHaveLength(2);
    expect(screen.getByText("Stripe Session:")).toBeInTheDocument();
    expect(screen.getByText("cs_test_123")).toBeInTheDocument();

    await waitFor(() => {
      expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    });
    expect(window.localStorage.getItem(`${CART_CLEARED_SESSION_PREFIX}${checkoutSessionId}`)).toBe("1");
  });

  it("renders processing state with non-eligible clear flag", async () => {
    getCartCheckoutSuccessStateMock.mockResolvedValueOnce({
      paymentStatus: "PENDING",
      orderStatus: "PLACED",
      reconciliationState: "PENDING",
      cartClearEligible: false,
      subtotalAmountMinor: null,
      discountAmountMinor: null,
      totalAmountMinor: null,
      totalPaidAmountMinor: null,
      stripePaidAmountMinor: 0,
      currencyCode: null,
      couponCodeSnapshot: null,
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: null,
      hasZeroValuePayment: false,
      items: [],
    });

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: "cs_test_pending",
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Payment Processing" })).toBeInTheDocument();
    expect(screen.queryByText("Cart Clear Eligible")).not.toBeInTheDocument();
    expect(screen.queryByText("Stripe/Card Remainder:")).not.toBeInTheDocument();
    expect(screen.getByText("No order items found for this checkout session.")).toBeInTheDocument();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it("does not clear cart for confirmed non-cart success state", async () => {
    const checkoutSessionId = "cs_test_non_cart";
    window.localStorage.setItem(
      `${CART_CHECKOUT_SNAPSHOT_PREFIX}${checkoutSessionId}`,
      "prod_1:price_1:1",
    );
    getCartCheckoutSuccessStateMock.mockResolvedValueOnce({
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      reconciliationState: "CONFIRMED",
      cartClearEligible: false,
      subtotalAmountMinor: 5000,
      discountAmountMinor: null,
      totalAmountMinor: 5000,
      totalPaidAmountMinor: 5000,
      stripePaidAmountMinor: 5000,
      currencyCode: "EUR",
      couponCodeSnapshot: null,
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: checkoutSessionId,
      hasZeroValuePayment: false,
      items: [
        {
          productId: "prod_1",
          priceId: "price_1",
          productNameSnapshot: "Cart Pack A",
          priceNameSnapshot: "Pack A",
          quantity: 1,
          unitAmountMinor: 5000,
          lineTotalAmountMinor: 5000,
          currencyCode: "EUR",
        },
      ],
    });

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: checkoutSessionId,
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Payment Confirmed" })).toBeInTheDocument();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(`${CART_CLEARED_SESSION_PREFIX}${checkoutSessionId}`)).toBeNull();
  });

  it("renders failed state with non-eligible clear flag", async () => {
    getCartCheckoutSuccessStateMock.mockResolvedValueOnce({
      paymentStatus: "FAILED",
      orderStatus: "CANCELLED",
      reconciliationState: "FAILED",
      cartClearEligible: false,
      subtotalAmountMinor: 11000,
      discountAmountMinor: null,
      totalAmountMinor: 11000,
      totalPaidAmountMinor: 0,
      stripePaidAmountMinor: 0,
      currencyCode: "EUR",
      couponCodeSnapshot: null,
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: "cs_test_failed",
      hasZeroValuePayment: false,
      items: [],
    });

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: "cs_test_failed",
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Payment Failed" })).toBeInTheDocument();
    expect(screen.getAllByText("FAILED")).toHaveLength(2);
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
    expect(screen.queryByText("Cart Clear Eligible")).not.toBeInTheDocument();
    expect(screen.queryByText("Stripe/Card Remainder:")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it("does not clear when statuses are not paid/succeeded even if data includes totals", async () => {
    getCartCheckoutSuccessStateMock.mockResolvedValueOnce({
      paymentStatus: "SUCCEEDED",
      orderStatus: "PLACED",
      reconciliationState: "CONFIRMED",
      cartClearEligible: false,
      subtotalAmountMinor: 11000,
      discountAmountMinor: null,
      totalAmountMinor: 11000,
      totalPaidAmountMinor: 11000,
      stripePaidAmountMinor: 11000,
      currencyCode: "EUR",
      couponCodeSnapshot: null,
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: "cs_test_not_paid",
      hasZeroValuePayment: false,
      items: [],
    });

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: "cs_test_not_paid",
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Payment Confirmed" })).toBeInTheDocument();
    expect(screen.queryByText("Cart Clear Eligible")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it("clears only purchased checkout scope and preserves unrelated cart items", async () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 8,
        lines: [
          {
            productId: "prod_1",
            priceId: "price_1",
            productName: "Cart Pack A",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "Pack A",
            priceType: "ONE_TIME",
            quantity: 1,
            unitAmountMinor: 5000,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
          {
            productId: "prod_new",
            priceId: "price_new",
            productName: "Unrelated Item",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "Unrelated Price",
            priceType: "ONE_TIME",
            quantity: 1,
            unitAmountMinor: 2000,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
        ],
      }),
    );

    const checkoutSessionId = "cs_test_scope_clear";
    window.localStorage.setItem(
      `${CART_CHECKOUT_SNAPSHOT_PREFIX}${checkoutSessionId}`,
      "prod_1:price_1:1|prod_new:price_new:1",
    );
    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: checkoutSessionId,
        }),
      }),
    );

    await waitFor(() => {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? "{}") as { lines?: Array<{ productId: string; priceId: string }> };
      expect(parsed.lines).toEqual([
        expect.objectContaining({
          productId: "prod_new",
          priceId: "price_new",
        }),
      ]);
    });
    expect(window.localStorage.getItem(`${CART_CLEARED_SESSION_PREFIX}${checkoutSessionId}`)).toBe("1");
  });

  it("does not wipe newly added items on revisit after cleared marker exists", async () => {
    const checkoutSessionId = "cs_test_revisit_marker";
    window.localStorage.setItem(
      `${CART_CHECKOUT_SNAPSHOT_PREFIX}${checkoutSessionId}`,
      "prod_1:price_1:1",
    );
    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: checkoutSessionId,
        }),
      }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(`${CART_CLEARED_SESSION_PREFIX}${checkoutSessionId}`)).toBe("1");
    });

    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 99,
        lines: [
          {
            productId: "prod_new_after_marker",
            priceId: "price_new_after_marker",
            productName: "New Item",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "New Price",
            priceType: "ONE_TIME",
            quantity: 1,
            unitAmountMinor: 2000,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
        ],
      }),
    );

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: checkoutSessionId,
        }),
      }),
    );

    await waitFor(() => {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? "{}") as { lines?: Array<{ productId: string; priceId: string }> };
      expect(parsed.lines).toEqual([
        expect.objectContaining({
          productId: "prod_new_after_marker",
          priceId: "price_new_after_marker",
        }),
      ]);
    });
  });

  it("does not clear when same line is re-added before first success-page hydration", async () => {
    const checkoutSessionId = "cs_test_same_line_race";
    window.localStorage.setItem(
      `${CART_CHECKOUT_SNAPSHOT_PREFIX}${checkoutSessionId}`,
      "prod_1:price_1:1",
    );
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 10,
        lines: [
          {
            productId: "prod_1",
            priceId: "price_1",
            productName: "Cart Pack A",
            productDescription: null,
            productType: "CLASS_PACK",
            priceName: "Pack A",
            priceType: "ONE_TIME",
            quantity: 2,
            unitAmountMinor: 5000,
            currencyCode: "EUR",
            billingInterval: null,
            billingIntervalCount: null,
          },
        ],
      }),
    );

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: checkoutSessionId,
        }),
      }),
    );

    await waitFor(() => {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? "{}") as { lines?: Array<{ productId: string; priceId: string; quantity: number }> };
      expect(parsed.lines).toEqual([
        expect.objectContaining({
          productId: "prod_1",
          priceId: "price_1",
          quantity: 2,
        }),
      ]);
    });
    expect(window.localStorage.getItem(`${CART_CLEARED_SESSION_PREFIX}${checkoutSessionId}`)).toBe("1");
  });

  it("renders zero-value internal payment state without a Stripe reference", async () => {
    getCartCheckoutSuccessStateMock.mockResolvedValueOnce({
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      reconciliationState: "CONFIRMED",
      cartClearEligible: true,
      subtotalAmountMinor: 2000,
      discountAmountMinor: 2000,
      totalAmountMinor: 0,
      totalPaidAmountMinor: 0,
      stripePaidAmountMinor: 0,
      currencyCode: "EUR",
      couponCodeSnapshot: "FREE100",
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: null,
      hasZeroValuePayment: true,
      items: [],
    });

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: "cs_test_zero",
        }),
      }),
    );

    expect(screen.getByText(/Internal zero-value payment recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/Stripe Session:/)).not.toBeInTheDocument();
    expect(screen.getByText("Subtotal:")).toBeInTheDocument();
    expect(screen.getByText("€20.00")).toBeInTheDocument();
    expect(screen.getByText("Coupon (FREE100):")).toBeInTheDocument();
    expect(screen.getByText("-€20.00")).toBeInTheDocument();
    expect(screen.getAllByText("€0.00")).toHaveLength(2);
  });
  it("clears confirmed orderId-based cart success state", async () => {
    const orderId = "order_cart_complete_123";
    window.localStorage.setItem(
      `${CART_CHECKOUT_SNAPSHOT_PREFIX}${orderId}`,
      "prod_1:price_1:1",
    );
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValueOnce({
      paymentStatus: "SUCCEEDED",
      orderStatus: "PAID",
      reconciliationState: "CONFIRMED",
      cartClearEligible: true,
      subtotalAmountMinor: 5000,
      discountAmountMinor: null,
      totalAmountMinor: 5000,
      totalPaidAmountMinor: 5000,
      stripePaidAmountMinor: 0,
      currencyCode: "EUR",
      couponCodeSnapshot: null,
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: null,
      hasZeroValuePayment: false,
      items: [
        {
          productId: "prod_1",
          priceId: "price_1",
          productNameSnapshot: "Cart Pack A",
          priceNameSnapshot: "Pack A",
          quantity: 1,
          unitAmountMinor: 5000,
          lineTotalAmountMinor: 5000,
          currencyCode: "EUR",
        },
      ],
    });

    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          orderId,
        }),
      }),
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    });
    expect(getCartCheckoutSuccessStateForOrderMock).toHaveBeenCalledWith({
      orderId,
      userId: "user_1",
    });
    expect(window.localStorage.getItem(`${CART_CLEARED_SESSION_PREFIX}${orderId}`)).toBe("1");
  });
});
