/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { PriceType, ProductType, StripeSyncStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  getAdminStoreMerchandiseById: vi.fn(),
  getAdminStoreGiftCardById: vi.fn(),
  getStorePriceCheckoutReadinessLabel: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, notFound: notFoundMock };
});

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/app/admin/(private)/store-actions", () => ({
  archiveStoreMerchandiseAction: vi.fn(),
  createStoreMerchandiseAction: vi.fn(),
  updateStoreMerchandiseAction: vi.fn(),
  retryStoreMerchandiseSyncAction: vi.fn(),
  archiveStoreGiftCardAction: vi.fn(),
  createStoreGiftCardAction: vi.fn(),
  updateStoreGiftCardAction: vi.fn(),
  retryStoreGiftCardSyncAction: vi.fn(),
}));

vi.mock("@/lib/store/store-admin-catalog-service", () => ({
  getAdminStoreMerchandiseById: mocks.getAdminStoreMerchandiseById,
  getAdminStoreGiftCardById: mocks.getAdminStoreGiftCardById,
  getStorePriceCheckoutReadinessLabel: mocks.getStorePriceCheckoutReadinessLabel,
}));

import AdminStoreGiftCardNewPage from "../../src/app/admin/(private)/store/gift-cards/new/page";
import AdminStoreGiftCardEditPage from "../../src/app/admin/(private)/store/gift-cards/[id]/edit/page";
import AdminStoreMerchandiseNewPage from "../../src/app/admin/(private)/store/merchandise/new/page";
import AdminStoreMerchandiseEditPage from "../../src/app/admin/(private)/store/merchandise/[id]/edit/page";

const activePrice = {
  id: "price-1",
  name: "Price",
  lookupKey: "store-price-1",
  priceType: PriceType.ONE_TIME,
  currencyCode: "EUR",
  unitAmountMinor: 2500,
  billingInterval: null,
  billingIntervalCount: null,
  stripePriceId: "price_test_1",
  stripeSyncStatus: StripeSyncStatus.SYNCED,
  stripeSyncError: null,
  isActive: true,
  isArchived: false,
};

const imageAsset = {
  id: "media-1",
  path: "/uploads/products/product.png",
  mimeType: "image/png",
  sizeBytes: 128,
  originalFilename: "product.png",
};

describe("admin Store image edit pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.getStorePriceCheckoutReadinessLabel.mockReturnValue("Ready");
  });

  it("shows current merchandise image preview and removal control", async () => {
    mocks.getAdminStoreMerchandiseById.mockResolvedValue({
      id: "merch-1",
      name: "Studio Tote Bag",
      slug: "studio-tote-bag",
      description: "Pickup at studio.",
      productType: ProductType.MERCHANDISE,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      imageAsset,
      primaryPrice: activePrice,
      isCheckoutReady: true,
    });

    const { container } = render(
      await AdminStoreMerchandiseEditPage({
        params: Promise.resolve({ id: "merch-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(container.querySelector("form")?.getAttribute("enctype")).toBe("multipart/form-data");
    expect(screen.getByAltText("Studio Tote Bag product image")).toBeInTheDocument();
    expect(screen.getByLabelText(/remove current image/i)).toHaveAttribute("name", "removeImage");
    expect(screen.getByLabelText(/replace image/i)).toHaveAttribute("name", "image");
  });

  it("shows current gift-card image preview and removal control", async () => {
    mocks.getAdminStoreGiftCardById.mockResolvedValue({
      id: "gift-1",
      name: "Gift Card 25 EUR",
      slug: "gift-card-25",
      description: "Studio gift card.",
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      imageAsset,
      activePrice,
      isCheckoutReady: true,
    });

    const { container } = render(
      await AdminStoreGiftCardEditPage({
        params: Promise.resolve({ id: "gift-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(container.querySelector("form")?.getAttribute("enctype")).toBe("multipart/form-data");
    expect(screen.getByAltText("Gift Card 25 EUR product image")).toBeInTheDocument();
    expect(screen.getByLabelText(/remove current image/i)).toHaveAttribute("name", "removeImage");
    expect(screen.getByLabelText(/replace image/i)).toHaveAttribute("name", "image");
  });

  it("renders file-upload-capable merchandise create form", async () => {
    const { container } = render(
      await AdminStoreMerchandiseNewPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(container.querySelector("form")?.getAttribute("enctype")).toBeNull();
    const imageInput = screen.getByLabelText(/product image/i);
    expect(imageInput).toHaveAttribute("name", "image");
    expect(imageInput).toHaveAttribute("type", "file");
  });

  it("renders file-upload-capable gift-card create form", async () => {
    const { container } = render(
      await AdminStoreGiftCardNewPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(container.querySelector("form")?.getAttribute("enctype")).toBeNull();
    const imageInput = screen.getByLabelText(/product image/i);
    expect(imageInput).toHaveAttribute("name", "image");
    expect(imageInput).toHaveAttribute("type", "file");
  });
});
