/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: "user_1" },
  })),
}));

const reconcileCatalogCheckoutSessionAfterReturnMock = vi.fn(async () => undefined);

vi.mock("@/lib/public-booking/stripe-webhook-service", () => ({
  reconcileCatalogCheckoutSessionAfterReturn: (...args: unknown[]) =>
    reconcileCatalogCheckoutSessionAfterReturnMock(...args),
}));

const getCartCheckoutSuccessStateForOrderMock = vi.fn();
const getCartCheckoutSuccessStateMock = vi.fn();

vi.mock("@/lib/cart/cart-success-state", () => ({
  getCartCheckoutSuccessStateForOrder: (...args: unknown[]) =>
    getCartCheckoutSuccessStateForOrderMock(...args),
  getCartCheckoutSuccessState: (...args: unknown[]) =>
    getCartCheckoutSuccessStateMock(...args),
}));

import StoreSuccessPage from "../../src/app/(protected)/store/success/page";

const confirmedCouponMerchandiseState = {
  paymentStatus: "SUCCEEDED",
  orderStatus: "PAID",
  reconciliationState: "CONFIRMED" as const,
  cartClearEligible: true,
  subtotalAmountMinor: 4000,
  discountAmountMinor: 1000,
  totalAmountMinor: 3000,
  totalPaidAmountMinor: 3000,
  stripePaidAmountMinor: 1500,
  currencyCode: "EUR",
  couponCodeSnapshot: "SAVE25",
  loyaltyCreditAmountMinor: 1000,
  walletAmountMinor: 500,
  stripeCheckoutSessionId: "cs_store_coupon",
  hasZeroValuePayment: false,
  hasGiftCardItems: false,
  items: [
    {
      productId: "prod-class-pack-1",
      priceId: "price-class-pack-1",
      productNameSnapshot: "5 Class Pack",
      priceNameSnapshot: "5 Class Pack",
      quantity: 1,
      unitAmountMinor: 4000,
      lineTotalAmountMinor: 3000,
      currencyCode: "EUR",
      productType: "CLASS_PACK",
    },
  ],
};

const confirmedGiftCardState = {
  paymentStatus: "SUCCEEDED",
  orderStatus: "PAID",
  reconciliationState: "CONFIRMED" as const,
  cartClearEligible: true,
  subtotalAmountMinor: 2500,
  discountAmountMinor: null,
  totalAmountMinor: 2500,
  totalPaidAmountMinor: 2500,
  stripePaidAmountMinor: 2500,
  currencyCode: "EUR",
  couponCodeSnapshot: null,
  loyaltyCreditAmountMinor: 0,
  walletAmountMinor: 0,
  stripeCheckoutSessionId: "cs_store_gift_card",
  hasZeroValuePayment: false,
  hasGiftCardItems: true,
  items: [
    {
      productId: "prod-gc-1",
      priceId: "price-gc-1",
      productNameSnapshot: "Gift Card 25 EUR",
      priceNameSnapshot: "Gift Card 25 EUR",
      quantity: 1,
      unitAmountMinor: 2500,
      lineTotalAmountMinor: 2500,
      currencyCode: "EUR",
      productType: "GIFT_CARD",
    },
  ],
};

describe("Store success page", () => {
  beforeEach(() => {
    getCartCheckoutSuccessStateForOrderMock.mockReset();
    getCartCheckoutSuccessStateMock.mockReset();
    reconcileCatalogCheckoutSessionAfterReturnMock.mockReset();
  });

  it("renders confirmed coupon state for eligible non-gift-card order using orderId", async () => {
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValue(confirmedCouponMerchandiseState);

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_abc123" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase Confirmed" })).toBeInTheDocument();
    expect(screen.getByText("5 Class Pack")).toBeInTheDocument();
    expect(screen.getByText("Subtotal:")).toBeInTheDocument();
    expect(screen.getByText("€40.00")).toBeInTheDocument();
    expect(screen.getByText("Coupon (SAVE25):")).toBeInTheDocument();
    expect(screen.getByText("Loyalty Credit:")).toBeInTheDocument();
    expect(screen.getAllByText("-€10.00")).toHaveLength(2);
    expect(screen.getByText("Gift Card Wallet:")).toBeInTheDocument();
    expect(screen.getByText("-€5.00")).toBeInTheDocument();
    expect(screen.getByText("Stripe/Card Remainder:")).toBeInTheDocument();
    expect(screen.getByText("€15.00")).toBeInTheDocument();
    expect(screen.getByText("Order Total:")).toBeInTheDocument();
    expect(screen.getAllByText("€30.00")).toHaveLength(3);
    expect(screen.getByText("Stripe Session:")).toBeInTheDocument();
    expect(screen.getByText("cs_store_coupon")).toBeInTheDocument();
    expect(screen.queryByTestId("gift-card-success-copy")).not.toBeInTheDocument();
    expect(getCartCheckoutSuccessStateForOrderMock).toHaveBeenCalledWith({
      orderId: "order_abc123",
      userId: "user_1",
    });
    expect(getCartCheckoutSuccessStateMock).not.toHaveBeenCalled();
    expect(reconcileCatalogCheckoutSessionAfterReturnMock).not.toHaveBeenCalled();
  });

  it("renders confirmed state for stripe-based checkout using session_id", async () => {
    getCartCheckoutSuccessStateMock.mockResolvedValue(confirmedCouponMerchandiseState);

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ session_id: "cs_test_abc" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase Confirmed" })).toBeInTheDocument();
    expect(getCartCheckoutSuccessStateMock).toHaveBeenCalledWith({
      checkoutSessionId: "cs_test_abc",
      userId: "user_1",
    });
    expect(getCartCheckoutSuccessStateForOrderMock).not.toHaveBeenCalled();
    expect(reconcileCatalogCheckoutSessionAfterReturnMock).toHaveBeenCalledWith({
      checkoutSessionId: "cs_test_abc",
      userId: "user_1",
    });
  });

  it("renders processing state when no params provided", async () => {
    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase Processing" })).toBeInTheDocument();
    expect(getCartCheckoutSuccessStateForOrderMock).not.toHaveBeenCalled();
    expect(getCartCheckoutSuccessStateMock).not.toHaveBeenCalled();
  });

  it("renders failed state when reconciliation is FAILED", async () => {
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValue({
      paymentStatus: "FAILED",
      orderStatus: "CANCELLED",
      reconciliationState: "FAILED",
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
      hasGiftCardItems: false,
      items: [],
    });

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_failed" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase Failed" })).toBeInTheDocument();
    expect(screen.getByText(/did not complete/i)).toBeInTheDocument();
    expect(screen.queryByText("Stripe/Card Remainder:")).not.toBeInTheDocument();
  });

  it("renders dashboard wallet and back to store links", async () => {
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValue(confirmedGiftCardState);

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_xyz" }),
      }),
    );

    expect(screen.getByRole("link", { name: "View Wallet Balance" })).toHaveAttribute(
      "href",
      "/dashboard/wallet",
    );
    expect(screen.getByRole("link", { name: "Back to Store" })).toHaveAttribute("href", "/store");
  });

  describe("gift-card success copy", () => {
    it("shows gift-card email copy when order contains gift card items and is CONFIRMED", async () => {
      getCartCheckoutSuccessStateForOrderMock.mockResolvedValue(confirmedGiftCardState);

      render(
        await StoreSuccessPage({
          searchParams: Promise.resolve({ orderId: "order_gc" }),
        }),
      );

      const copyBlock = screen.getByTestId("gift-card-success-copy");
      expect(copyBlock).toBeInTheDocument();
      expect(screen.getByText(/your gift card code has been sent to your email/i)).toBeInTheDocument();
      expect(screen.getByText(/use the code to add funds to your wallet/i)).toBeInTheDocument();
    });

    it("does NOT show gift-card email copy for merchandise-only orders", async () => {
      getCartCheckoutSuccessStateForOrderMock.mockResolvedValue(confirmedCouponMerchandiseState);

      render(
        await StoreSuccessPage({
          searchParams: Promise.resolve({ orderId: "order_merch" }),
        }),
      );

      expect(screen.getByRole("heading", { name: "Purchase Confirmed" })).toBeInTheDocument();
      expect(screen.queryByTestId("gift-card-success-copy")).not.toBeInTheDocument();
      expect(screen.queryByText(/your gift card code has been sent/i)).not.toBeInTheDocument();
    });

    it("does NOT show gift-card email copy when order is PENDING", async () => {
      getCartCheckoutSuccessStateForOrderMock.mockResolvedValue({
        ...confirmedGiftCardState,
        reconciliationState: "PENDING" as const,
        cartClearEligible: false,
        stripePaidAmountMinor: 0,
      });

      render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_pending" }),
      }),
    );

      expect(screen.getByRole("heading", { name: "Purchase Processing" })).toBeInTheDocument();
      expect(screen.queryByText("Stripe/Card Remainder:")).not.toBeInTheDocument();
      expect(screen.queryByTestId("gift-card-success-copy")).not.toBeInTheDocument();
    });
  });

  it("renders internal zero-value payment state without Stripe reference", async () => {
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValue({
      ...confirmedCouponMerchandiseState,
      discountAmountMinor: 4000,
      totalAmountMinor: 0,
      totalPaidAmountMinor: 0,
      stripePaidAmountMinor: 0,
      couponCodeSnapshot: "FREE100",
      loyaltyCreditAmountMinor: 0,
      walletAmountMinor: 0,
      stripeCheckoutSessionId: null,
      hasZeroValuePayment: true,
    });

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_zero" }),
      }),
    );

    expect(screen.getByText(/Internal zero-value payment recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/Stripe Session:/)).not.toBeInTheDocument();
    expect(screen.getByText("Subtotal:")).toBeInTheDocument();
    expect(screen.getByText("€40.00")).toBeInTheDocument();
    expect(screen.getByText("Coupon (FREE100):")).toBeInTheDocument();
    expect(screen.getByText("-€40.00")).toBeInTheDocument();
    expect(screen.getAllByText("€0.00")).toHaveLength(2);
  });
});
