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

const confirmedState = {
  paymentStatus: "SUCCEEDED",
  orderStatus: "PAID",
  reconciliationState: "CONFIRMED" as const,
  cartClearEligible: true,
  subtotalAmountMinor: 2500,
  totalAmountMinor: 2500,
  currencyCode: "EUR",
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
    },
  ],
};

describe("Store success page", () => {
  beforeEach(() => {
    getCartCheckoutSuccessStateForOrderMock.mockReset();
    getCartCheckoutSuccessStateMock.mockReset();
    reconcileCatalogCheckoutSessionAfterReturnMock.mockReset();
  });

  it("renders confirmed state for full-wallet checkout using orderId (no session_id)", async () => {
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValue(confirmedState);

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_abc123" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase Confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Gift Card 25 EUR")).toBeInTheDocument();
    expect(screen.getAllByText("€25.00").length).toBeGreaterThan(0);
    expect(getCartCheckoutSuccessStateForOrderMock).toHaveBeenCalledWith({
      orderId: "order_abc123",
      userId: "user_1",
    });
    expect(getCartCheckoutSuccessStateMock).not.toHaveBeenCalled();
    expect(reconcileCatalogCheckoutSessionAfterReturnMock).not.toHaveBeenCalled();
  });

  it("renders confirmed state for stripe-based partial wallet using session_id", async () => {
    getCartCheckoutSuccessStateMock.mockResolvedValue(confirmedState);

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
      totalAmountMinor: null,
      currencyCode: null,
      items: [],
    });

    render(
      await StoreSuccessPage({
        searchParams: Promise.resolve({ orderId: "order_failed" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Purchase Failed" })).toBeInTheDocument();
    expect(screen.getByText(/did not complete/i)).toBeInTheDocument();
  });

  it("renders dashboard wallet and back to store links", async () => {
    getCartCheckoutSuccessStateForOrderMock.mockResolvedValue(confirmedState);

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
});
