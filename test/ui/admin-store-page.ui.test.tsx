/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
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

function buildMerchandise(index: number, withPrice = true) {
  return {
    id: `merch-${index}`,
    name: `Merch ${index}`,
    slug: `merch-${index}`,
    description: "Pickup at studio",
    productType: ProductType.MERCHANDISE,
    isActive: true,
    isArchived: false,
    sortOrder: index,
    primaryPrice: withPrice ? { ...price, id: `price-merch-${index}`, unitAmountMinor: 1000 + index } : null,
    isCheckoutReady: withPrice,
  };
}

function buildGiftCard(index: number, withPrice = true) {
  return {
    id: `gift-${index}`,
    name: `Gift ${index}`,
    slug: `gift-${index}`,
    description: "Studio gift card.",
    productType: ProductType.GIFT_CARD,
    isActive: true,
    isArchived: false,
    sortOrder: index,
    activePrice: withPrice ? { ...price, id: `price-gift-${index}`, unitAmountMinor: 5000 + index } : null,
    isCheckoutReady: withPrice,
  };
}

describe("admin store page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.listAdminStoreMerchandise.mockReset();
    mocks.listAdminStoreGiftCardProducts.mockReset();
  });

  it("renders only Name, Price, Status, Actions headers and omits removed operational headers", async () => {
    mocks.listAdminStoreMerchandise.mockResolvedValue([buildMerchandise(1)]);
    mocks.listAdminStoreGiftCardProducts.mockResolvedValue([buildGiftCard(1)]);

    render(await AdminStorePage({ searchParams: Promise.resolve({}) }));

    const merchandiseTable = screen.getByTestId("admin-store-merchandise-table");
    const giftCardsTable = screen.getByTestId("admin-store-gift-cards-table");

    expect(within(merchandiseTable).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(merchandiseTable).getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(within(merchandiseTable).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(merchandiseTable).getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();

    expect(within(giftCardsTable).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(giftCardsTable).getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(within(giftCardsTable).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(giftCardsTable).getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();

    expect(screen.queryByRole("columnheader", { name: "Fulfillment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Stripe ID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Checkout Ready" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Visible to Client" })).not.toBeInTheDocument();
  });

  it("shows placeholder price for gift cards with no active sellable price", async () => {
    mocks.listAdminStoreMerchandise.mockResolvedValue([buildMerchandise(1)]);
    mocks.listAdminStoreGiftCardProducts.mockResolvedValue([buildGiftCard(1, false)]);

    render(await AdminStorePage({ searchParams: Promise.resolve({}) }));

    const giftCardsTable = screen.getByTestId("admin-store-gift-cards-table");
    expect(within(giftCardsTable).getByText("-")).toBeInTheDocument();
  });

  it("paginates merchandise and gift cards independently with separate query params", async () => {
    mocks.listAdminStoreMerchandise.mockResolvedValue(Array.from({ length: 12 }, (_, i) => buildMerchandise(i + 1)));
    mocks.listAdminStoreGiftCardProducts.mockResolvedValue(Array.from({ length: 12 }, (_, i) => buildGiftCard(i + 1)));

    render(
      await AdminStorePage({
        searchParams: Promise.resolve({ merchandisePage: "2", giftCardPage: "1" }),
      }),
    );

    const merchandiseTable = screen.getByTestId("admin-store-merchandise-table");
    const giftCardsTable = screen.getByTestId("admin-store-gift-cards-table");

    expect(within(merchandiseTable).getByText("Merch 11")).toBeInTheDocument();
    expect(within(merchandiseTable).queryByText("Merch 1")).not.toBeInTheDocument();

    expect(within(giftCardsTable).getByText("Gift 1")).toBeInTheDocument();
    expect(within(giftCardsTable).queryByText("Gift 11")).not.toBeInTheDocument();

    const merchandisePagination = screen.getByTestId("admin-store-merchandise-pagination");
    const giftCardsPagination = screen.getByTestId("admin-store-gift-cards-pagination");

    expect(within(merchandisePagination).getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(giftCardsPagination).getByText("Page 1 of 2")).toBeInTheDocument();

    const giftNextLink = within(giftCardsPagination).getByRole("link", { name: "Next" });
    expect(giftNextLink).toHaveAttribute("href", "?merchandisePage=2&giftCardPage=2#gift-cards");

    const merchPrevLink = within(merchandisePagination).getByRole("link", { name: "Previous" });
    expect(merchPrevLink).toHaveAttribute("href", "?giftCardPage=1#merchandising");
  });
});
