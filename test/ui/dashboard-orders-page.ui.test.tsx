/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GiftCardCodeStatus, OrderStatus, ProductType } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getClientOrderHistory: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/dashboard/dashboard-service", () => ({
  getClientOrderHistory: mocks.getClientOrderHistory,
}));

vi.mock("../../src/app/(protected)/dashboard/orders/ResendGiftCardCodeButton", () => ({
  ResendGiftCardCodeButton: ({ orderItemId }: { orderItemId: string }) => (
    <button type="button" data-testid="resend-gift-card-code">
      Resend code for {orderItemId}
    </button>
  ),
}));

import DashboardOrdersPage from "../../src/app/(protected)/dashboard/orders/page";

const merchandiseItem = {
  id: "item-merch-1",
  productNameSnapshot: "Studio Tote Bag",
  productType: ProductType.MERCHANDISE,
  imageAsset: null,
  quantity: 1,
  unitAmountMinor: 2500,
  lineTotalAmountMinor: 2500,
  currencyCode: "EUR",
  giftCardCode: null,
};

const giftCardItem = {
  id: "item-gc-1",
  productNameSnapshot: "Gift Card EUR 50",
  productType: ProductType.GIFT_CARD,
  imageAsset: null,
  quantity: 1,
  unitAmountMinor: 5000,
  lineTotalAmountMinor: 5000,
  currencyCode: "EUR",
  giftCardCode: {
    maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-ABCD1234",
    status: GiftCardCodeStatus.ISSUED,
  },
};

const classPackItem = {
  id: "item-pack-1",
  productNameSnapshot: "10-Class Pack",
  productType: ProductType.CLASS_PACK,
  imageAsset: null,
  quantity: 1,
  unitAmountMinor: 15000,
  lineTotalAmountMinor: 15000,
  currencyCode: "EUR",
  giftCardCode: null,
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
    mocks.getClientOrderHistory.mockReset();
  });

  it("renders empty state when no orders exist", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([]);

    render(await DashboardOrdersPage());

    expect(screen.getByRole("heading", { name: "My Purchases" })).toBeInTheDocument();
    expect(screen.getByTestId("orders-empty")).toBeInTheDocument();
    expect(screen.getByText(/no purchases yet/i)).toBeInTheDocument();
  });

  it("renders merchandise order with all item details", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([baseOrder]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    expect(screen.getByText("Studio Tote Bag")).toBeInTheDocument();
    expect(screen.getByTestId("order-total")).toHaveTextContent("25.00");
    expect(screen.getByTestId("order-status")).toHaveTextContent("Paid");
  });

  it("shows fulfillment note for merchandise orders", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([baseOrder]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("fulfillment-note")).toHaveTextContent("Pickup at studio");
  });

  it("renders product image in purchase history when available", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        items: [
          {
            ...merchandiseItem,
            imageAsset: {
              id: "media-1",
              path: "/uploads/products/studio-tote.png",
              mimeType: "image/png",
              sizeBytes: 128,
              originalFilename: "studio-tote.png",
            },
          },
        ],
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByAltText("Studio Tote Bag product image")).toBeInTheDocument();
  });

  it("does not show fulfillment note for gift-card-only orders", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
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
    mocks.getClientOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        id: "order-gc",
        items: [giftCardItem],
        totalAmountMinor: 5000,
        fulfillmentNote: null,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByText("Gift Card EUR 50")).toBeInTheDocument();
    expect(screen.getByText("Gift Card")).toBeInTheDocument();
  });

  it("renders gift-card masked code and resend button without exposing plaintext or hash", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        id: "order-gc",
        items: [giftCardItem],
        totalAmountMinor: 5000,
        fulfillmentNote: null,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("gift-card-masked")).toHaveTextContent(
      "XXXXXXXX-XXXXXXXX-XXXXXXXX-ABCD1234",
    );
    expect(screen.getByTestId("gift-card-status")).toHaveTextContent("Not yet redeemed");
    expect(screen.getByTestId("resend-gift-card-code")).toBeInTheDocument();
    expect(screen.queryByText(/^[0-9a-f]{64}$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ABCD1234-ABCD1234-ABCD1234-ABCD1234")).not.toBeInTheDocument();
  });

  it("does not render resend button for redeemed gift cards", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        id: "order-gc-redeemed",
        items: [
          {
            ...giftCardItem,
            giftCardCode: { ...giftCardItem.giftCardCode, status: GiftCardCodeStatus.REDEEMED },
          },
        ],
        totalAmountMinor: 5000,
        fulfillmentNote: null,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("gift-card-status")).toHaveTextContent("Redeemed");
    expect(screen.queryByTestId("resend-gift-card-code")).not.toBeInTheDocument();
  });

  it("renders class pack orders in unified purchase history", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        id: "order-pack",
        items: [classPackItem],
        totalAmountMinor: 15000,
        fulfillmentNote: null,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByText("10-Class Pack")).toBeInTheDocument();
    expect(screen.getByText("Class Pack")).toBeInTheDocument();
  });

  it("renders quantity for multi-quantity line items", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      {
        ...baseOrder,
        items: [{ ...merchandiseItem, quantity: 3, lineTotalAmountMinor: 7500 }],
        totalAmountMinor: 7500,
      },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByText(/x 3/)).toBeInTheDocument();
  });

  it("does not render quantity marker for single-quantity items", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([baseOrder]);

    render(await DashboardOrdersPage());

    expect(screen.queryByText(/x 1/)).not.toBeInTheDocument();
  });

  it("renders multiple orders in the list", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      baseOrder,
      { ...baseOrder, id: "order-2", items: [giftCardItem], totalAmountMinor: 5000, fulfillmentNote: null },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getAllByTestId("order-item")).toHaveLength(2);
  });

  it("renders PLACED order as 'Pending'", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([{ ...baseOrder, status: OrderStatus.PLACED }]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("order-status")).toHaveTextContent("Pending");
  });

  it("renders CANCELLED order as 'Cancelled'", async () => {
    mocks.getClientOrderHistory.mockResolvedValue([
      { ...baseOrder, status: OrderStatus.CANCELLED },
    ]);

    render(await DashboardOrdersPage());

    expect(screen.getByTestId("order-status")).toHaveTextContent("Cancelled");
  });

  it("calls order history service with the authenticated user id", async () => {
    const userId = "user-store-456";
    mocks.requireAuth.mockResolvedValue({ user: { id: userId } });
    mocks.getClientOrderHistory.mockResolvedValue([]);

    await DashboardOrdersPage();

    expect(mocks.getClientOrderHistory).toHaveBeenCalledWith(userId);
  });
});
