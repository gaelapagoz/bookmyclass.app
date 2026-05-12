/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus, ProductType } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getClientStoreOrderHistory: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/dashboard/dashboard-service", () => ({
  getClientStoreOrderHistory: mocks.getClientStoreOrderHistory,
}));

import DashboardOrdersPage from "../../src/app/(protected)/dashboard/orders/page";

const merchandiseItem = {
  id: "item-merch-1",
  productNameSnapshot: "Studio Tote Bag",
  productType: ProductType.MERCHANDISE,
  quantity: 1,
  unitAmountMinor: 2500,
  lineTotalAmountMinor: 2500,
  currencyCode: "EUR",
};

const giftCardItem = {
  id: "item-gc-1",
  productNameSnapshot: "Gift Card €50",
  productType: ProductType.GIFT_CARD,
  quantity: 1,
  unitAmountMinor: 5000,
  lineTotalAmountMinor: 5000,
  currencyCode: "EUR",
};

const baseOrder = {
  id: "order-1",
  status: OrderStatus.PAID,
  placedAt: new Date("2026-01-15T10:00:00Z").toISOString(),
  totalAmountMinor: 2500,
  currencyCode: "EUR",
  items: [merchandiseItem],
  fulfillmentNote: "Pickup at studio",
};

describe("Dashboard orders page", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.getClientStoreOrderHistory.mockReset();
  });

  it("renders empty state when no orders exist", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([]);

    render(await DashboardOrdersPage());

    expect(screen.getByRole("heading", { name: "My Purchases" })).toBeInTheDocument();
    expect(screen.getByTestId("orders-empty")).toBeInTheDocument();
    expect(screen.getByText(/no store purchases yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visit the Store" })).toHaveAttribute("href", "/store");
  });

  it("renders merchandise order with all item details", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([baseOrder]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    expect(screen.getByText("Studio Tote Bag")).toBeInTheDocument();
    expect(screen.getByTestId("order-total")).toHaveTextContent("€25.00");
    expect(screen.getByTestId("order-status")).toHaveTextContent("Paid");
  });

  it("shows fulfillment note for merchandise orders", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([baseOrder]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("fulfillment-note")).toHaveTextContent("Pickup at studio");
  });

  it("does not show fulfillment note for gift-card-only orders", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        id: "order-gc",
        items: [giftCardItem],
        totalAmountMinor: 5000,
        fulfillmentNote: null,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.queryByTestId("fulfillment-note")).not.toBeInTheDocument();
  });

  it("renders gift-card order with product type label", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        id: "order-gc",
        items: [giftCardItem],
        totalAmountMinor: 5000,
        fulfillmentNote: null,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByText("Gift Card €50")).toBeInTheDocument();
    expect(screen.getByText("Gift Card")).toBeInTheDocument();
  });

  it("renders quantity for multi-quantity line items", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        items: [{ ...merchandiseItem, quantity: 3, lineTotalAmountMinor: 7500 }],
        totalAmountMinor: 7500,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByText(/× 3/)).toBeInTheDocument();
  });

  it("does not render quantity marker for single-quantity items", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([baseOrder]);

    render(await DashboardOrdersPage());

    expect(screen.queryByText(/× 1/)).not.toBeInTheDocument();
  });

  it("renders multiple orders in the list", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([
      baseOrder,
      { ...baseOrder, id: "order-2", items: [giftCardItem], totalAmountMinor: 5000, fulfillmentNote: null },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getAllByTestId("order-item")).toHaveLength(2);
  });

  it("renders PLACED order as 'Pending'", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([
      { ...baseOrder, status: OrderStatus.PLACED },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("order-status")).toHaveTextContent("Pending");
  });

  it("renders CANCELLED order as 'Cancelled'", async () => {
    mocks.getClientStoreOrderHistory.mockResolvedValue([
      { ...baseOrder, status: OrderStatus.CANCELLED },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("order-status")).toHaveTextContent("Cancelled");
  });

  it("calls order history service with the authenticated user id", async () => {
    const userId = "user-store-456";
    mocks.requireAuth.mockResolvedValue({ user: { id: userId } });
    mocks.getClientStoreOrderHistory.mockResolvedValue([]);

    await DashboardOrdersPage();

    expect(mocks.getClientStoreOrderHistory).toHaveBeenCalledWith(userId);
  });
});
