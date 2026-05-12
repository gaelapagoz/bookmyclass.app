/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { PriceType, ProductType, Role, StripeSyncStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  listAdminStoreMerchandise: vi.fn(),
  listAdminStoreGiftCardProducts: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/store/store-admin-catalog-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store/store-admin-catalog-service")>();
  return {
    ...actual,
    listAdminStoreMerchandise: mocks.listAdminStoreMerchandise,
    listAdminStoreGiftCardProducts: mocks.listAdminStoreGiftCardProducts,
  };
});

import AdminStorePage from "../../src/app/admin/(private)/store/page";

const price = {
  id: "price-1",
  name: "Store Price",
  lookupKey: "store-price",
  priceType: PriceType.ONE_TIME,
  currencyCode: "EUR",
  unitAmountMinor: 2500,
  billingInterval: null,
  billingIntervalCount: null,
  stripePriceId: "price_test_store",
  stripeSyncStatus: StripeSyncStatus.SYNCED,
  isActive: true,
  isArchived: false,
};

describe("admin store page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.listAdminStoreMerchandise.mockReset();
    mocks.listAdminStoreGiftCardProducts.mockReset();
  });

  it("shows Needs Stripe sync label and Visible to Client: No for unsynced merchandise", async () => {
    mocks.listAdminStoreMerchandise.mockResolvedValue([
      {
        id: "merch-unsynced",
        name: "Unsynced Product",
        slug: "unsynced-product",
        description: null,
        productType: ProductType.MERCHANDISE,
        isActive: true,
        isArchived: false,
        sortOrder: 10,
        primaryPrice: {
          ...price,
          stripePriceId: null,
          stripeSyncStatus: StripeSyncStatus.PENDING,
        },
        isCheckoutReady: false,
      },
    ]);
    mocks.listAdminStoreGiftCardProducts.mockResolvedValue([]);

    render(await AdminStorePage());

    expect(screen.getByText("Unsynced Product")).toBeInTheDocument();
    expect(screen.getByText(/needs stripe sync/i)).toBeInTheDocument();
    const visibleCells = screen.getAllByText("No");
    expect(visibleCells.length).toBeGreaterThan(0);
  });

  it("renders separate Merchandising and Gift Cards sections with create/edit actions", async () => {
    mocks.listAdminStoreMerchandise.mockResolvedValue([
      {
        id: "merch-1",
        name: "Studio Tote Bag",
        slug: "studio-tote-bag",
        description: "Pickup at studio",
        productType: ProductType.MERCHANDISE,
        isActive: true,
        isArchived: false,
        sortOrder: 10,
        primaryPrice: price,
        isCheckoutReady: true,
      },
    ]);
    mocks.listAdminStoreGiftCardProducts.mockResolvedValue([
      {
        id: "gift-1",
        name: "Gift Card 25 EUR",
        slug: "gift-card-25-eur",
        description: "Studio gift card.",
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
        sortOrder: 20,
        activePrice: price,
        isCheckoutReady: true,
      },
    ]);

    render(await AdminStorePage());

    expect(screen.getByRole("heading", { name: "Store" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Merchandising" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gift Cards" })).toBeInTheDocument();
    expect(screen.getByText("Studio Tote Bag")).toBeInTheDocument();
    expect(screen.getByText("Gift Card 25 EUR")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add merchandise" })).toHaveAttribute(
      "href",
      "/admin/store/merchandise/new",
    );
    expect(screen.getByRole("link", { name: "Add gift card" })).toHaveAttribute(
      "href",
      "/admin/store/gift-cards/new",
    );
    expect(screen.getAllByRole("link", { name: "Edit" }).map((link) => link.getAttribute("href"))).toEqual([
      "/admin/store/merchandise/merch-1/edit",
      "/admin/store/gift-cards/gift-1/edit",
    ]);
  });
});
