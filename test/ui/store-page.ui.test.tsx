/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { ProductType, StripeSyncStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_PICKUP_WORDING } from "@/lib/store/store-constants";

const mocks = vi.hoisted(() => ({
  listStoreCatalogReadModels: vi.fn(),
}));

vi.mock("@/lib/store/store-catalog", () => ({
  listStoreCatalogReadModels: mocks.listStoreCatalogReadModels,
}));

import StorePage from "../../src/app/(public)/store/page";

function makeGiftCard(overrides?: object) {
  return {
    id: "prod-gc-1",
    name: "Gift Card 25 EUR",
    slug: "gift-card-25-eur",
    description: "Studio gift card.",
    productType: ProductType.GIFT_CARD,
    imageAsset: null,
    fulfillmentLabel: null,
    prices: [],
    checkoutPrices: [
      {
        id: "price-gc-1",
        name: "Gift Card 25 EUR",
        lookupKey: "store-gift-card-25-eur",
        priceType: "ONE_TIME",
        currencyCode: "EUR",
        unitAmountMinor: 2500,
        billingInterval: null,
        billingIntervalCount: null,
        stripePriceId: "price_test_gc25",
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        isActive: true,
        isArchived: false,
      },
    ],
    ...overrides,
  };
}

function makeMerchandise(overrides?: object) {
  return {
    id: "prod-merch-1",
    name: "Studio Tote Bag",
    slug: "studio-tote-bag",
    description: STORE_PICKUP_WORDING,
    productType: ProductType.MERCHANDISE,
    imageAsset: null,
    fulfillmentLabel: STORE_PICKUP_WORDING,
    prices: [],
    checkoutPrices: [
      {
        id: "price-merch-1",
        name: "Studio Tote Bag",
        lookupKey: "store-merch-tote-bag",
        priceType: "ONE_TIME",
        currencyCode: "EUR",
        unitAmountMinor: 2200,
        billingInterval: null,
        billingIntervalCount: null,
        stripePriceId: "price_test_merch1",
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        isActive: true,
        isArchived: false,
      },
    ],
    ...overrides,
  };
}

describe("Store page", () => {
  beforeEach(() => {
    mocks.listStoreCatalogReadModels.mockReset();
  });

  it("renders gift-card and merchandise products", async () => {
    mocks.listStoreCatalogReadModels.mockResolvedValue([makeGiftCard(), makeMerchandise()]);

    render(await StorePage());

    expect(screen.getByRole("heading", { name: "Gift Cards" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Merchandise" })).toBeInTheDocument();
    expect(screen.getByText("Gift Card 25 EUR")).toBeInTheDocument();
    expect(screen.getByText("Studio Tote Bag")).toBeInTheDocument();
  });

  it("shows pickup wording on all merchandise product cards", async () => {
    mocks.listStoreCatalogReadModels.mockResolvedValue([makeMerchandise()]);

    render(await StorePage());

    const pickupLabels = screen.getAllByTestId("pickup-wording");
    expect(pickupLabels.length).toBeGreaterThan(0);
    for (const label of pickupLabels) {
      expect(label).toHaveTextContent(STORE_PICKUP_WORDING);
    }
  });

  it("renders uploaded product image when available", async () => {
    mocks.listStoreCatalogReadModels.mockResolvedValue([
      makeMerchandise({
        imageAsset: {
          id: "media-1",
          path: "/uploads/products/studio-tote.png",
          mimeType: "image/png",
          sizeBytes: 128,
          originalFilename: "studio-tote.png",
        },
      }),
    ]);

    render(await StorePage());

    expect(screen.getByAltText("Studio Tote Bag product image")).toBeInTheDocument();
  });

  it("renders safe placeholder when product has no image", async () => {
    mocks.listStoreCatalogReadModels.mockResolvedValue([makeMerchandise()]);

    render(await StorePage());

    expect(screen.getByTestId("store-product-placeholder")).toHaveTextContent("Studio Store");
  });

  it("renders only checkout-ready prices (not unsynced prices)", async () => {
    const productWithUnsyncedPrice = makeGiftCard({
      checkoutPrices: [],
    });
    mocks.listStoreCatalogReadModels.mockResolvedValue([productWithUnsyncedPrice]);

    render(await StorePage());

    expect(screen.getByText("Not available for checkout.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
  });

  it("renders empty store message when no products exist", async () => {
    mocks.listStoreCatalogReadModels.mockResolvedValue([]);

    render(await StorePage());

    expect(screen.getByText(/no products are currently available/i)).toBeInTheDocument();
  });
});
