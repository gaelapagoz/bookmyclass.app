import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
);

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  assertSameOriginServerAction: vi.fn(),
  createAdminStoreMerchandise: vi.fn(),
  createAdminStoreGiftCardProduct: vi.fn(),
  updateAdminStoreMerchandise: vi.fn(),
  updateAdminStoreGiftCardProduct: vi.fn(),
  getAdminStoreMerchandiseById: vi.fn(),
  getAdminStoreGiftCardById: vi.fn(),
  setAdminStoreProductActiveState: vi.fn(),
  uploadStoreProductImage: vi.fn(),
  unlinkStoreProductImage: vi.fn(),
  validateProductImageUpload: vi.fn(),
  attemptStorePriceSyncFromEnv: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: mocks.assertSameOriginServerAction,
}));

vi.mock("@/lib/store/store-admin-catalog-service", () => ({
  archiveAdminStoreMerchandise: vi.fn(),
  archiveAdminStoreGiftCardProduct: vi.fn(),
  createAdminStoreMerchandise: mocks.createAdminStoreMerchandise,
  createAdminStoreGiftCardProduct: mocks.createAdminStoreGiftCardProduct,
  updateAdminStoreMerchandise: mocks.updateAdminStoreMerchandise,
  updateAdminStoreGiftCardProduct: mocks.updateAdminStoreGiftCardProduct,
  getAdminStoreMerchandiseById: mocks.getAdminStoreMerchandiseById,
  getAdminStoreGiftCardById: mocks.getAdminStoreGiftCardById,
  setAdminStoreProductActiveState: mocks.setAdminStoreProductActiveState,
}));

vi.mock("@/lib/store/store-stripe-sync-service", () => ({
  attemptStorePriceSyncFromEnv: mocks.attemptStorePriceSyncFromEnv,
}));

vi.mock("@/lib/media/product-media-service", () => ({
  ProductMediaError: class ProductMediaError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  uploadStoreProductImage: mocks.uploadStoreProductImage,
  unlinkStoreProductImage: mocks.unlinkStoreProductImage,
  validateProductImageUpload: mocks.validateProductImageUpload,
}));

import {
  createStoreGiftCardAction,
  createStoreMerchandiseAction,
  updateStoreGiftCardAction,
  updateStoreMerchandiseAction,
  retryStoreMerchandiseSyncAction,
  retryStoreGiftCardSyncAction,
} from "../../src/app/admin/(private)/store-actions";
import { ProductMediaError } from "../../src/lib/media/product-media-service";

function makeForm(input: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, value);
  }
  return formData;
}

const baseForm = {
  name: "Store Item",
  description: "Customer visible product",
  sortOrder: "10",
  priceName: "Store Item",
  unitAmount: "25",
  isActive: "on",
};

describe("admin store actions", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    mocks.requireAdminSession.mockReset();
    mocks.assertSameOriginServerAction.mockReset();
    mocks.createAdminStoreMerchandise.mockReset();
    mocks.createAdminStoreGiftCardProduct.mockReset();
    mocks.updateAdminStoreMerchandise.mockReset();
    mocks.updateAdminStoreGiftCardProduct.mockReset();
    mocks.getAdminStoreMerchandiseById.mockReset();
    mocks.getAdminStoreGiftCardById.mockReset();
    mocks.setAdminStoreProductActiveState.mockReset();
    mocks.uploadStoreProductImage.mockReset();
    mocks.unlinkStoreProductImage.mockReset();
    mocks.validateProductImageUpload.mockReset();
    mocks.attemptStorePriceSyncFromEnv.mockReset();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.assertSameOriginServerAction.mockResolvedValue(undefined);
    mocks.validateProductImageUpload.mockResolvedValue(null);
  });

  it("keeps merchandise create flow and returns to unified Store", async () => {
    mocks.createAdminStoreMerchandise.mockResolvedValue({ id: "merch-1" });

    await expect(createStoreMerchandiseAction(makeForm(baseForm))).rejects.toThrow("NEXT_REDIRECT:/admin/store");

    expect(mocks.createAdminStoreMerchandise).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Store Item", unitAmountMinor: 2500, isActive: true }),
    );
  });

  it("uploads merchandise image after product creation", async () => {
    const image = new File([new Uint8Array([0x89])], "mat.png", { type: "image/png" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.createAdminStoreMerchandise.mockResolvedValue({ id: "merch-1" });

    await expect(createStoreMerchandiseAction(form)).rejects.toThrow("NEXT_REDIRECT:/admin/store");

    expect(mocks.validateProductImageUpload).toHaveBeenCalledWith(image);
    expect(mocks.uploadStoreProductImage).toHaveBeenCalledWith({
      productId: "merch-1",
      uploadedById: "admin-1",
      file: image,
    });
    expect(mocks.createAdminStoreMerchandise).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.setAdminStoreProductActiveState).toHaveBeenCalledWith("merch-1", true);
  });

  it("leaves created merchandise inactive when image upload fails", async () => {
    const image = new File([new Uint8Array([0x89])], "mat.png", { type: "image/png" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.createAdminStoreMerchandise.mockResolvedValue({ id: "merch-1" });
    mocks.uploadStoreProductImage.mockRejectedValue(new Error("IMAGE_WRITE_FAILED"));

    await expect(createStoreMerchandiseAction(form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/new",
    );

    expect(mocks.createAdminStoreMerchandise).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.setAdminStoreProductActiveState).not.toHaveBeenCalled();
  });

  it("keeps merchandise edit flow and returns to unified Store", async () => {
    mocks.updateAdminStoreMerchandise.mockResolvedValue(undefined);

    await expect(updateStoreMerchandiseAction("merch-1", makeForm(baseForm))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store",
    );

    expect(mocks.updateAdminStoreMerchandise).toHaveBeenCalledWith(
      "merch-1",
      expect.objectContaining({ name: "Store Item", unitAmountMinor: 2500, isArchived: false }),
    );
  });

  it("merchandise edit rejects missing price and redirects with error", async () => {
    const formWithoutPrice = makeForm({ ...baseForm, unitAmount: "" });

    await expect(updateStoreMerchandiseAction("merch-1", formWithoutPrice)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit",
    );

    expect(mocks.updateAdminStoreMerchandise).not.toHaveBeenCalled();
  });

  it("merchandise edit surfaces service error as redirect with error code", async () => {
    mocks.updateAdminStoreMerchandise.mockRejectedValue(new Error("INVALID_AMOUNT"));

    await expect(
      updateStoreMerchandiseAction("merch-1", makeForm(baseForm)),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit");

    expect(mocks.updateAdminStoreMerchandise).toHaveBeenCalledOnce();
  });

  it("replaces merchandise image on edit", async () => {
    const image = new File([new Uint8Array([0xff])], "mat.jpg", { type: "image/jpeg" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.updateAdminStoreMerchandise.mockResolvedValue(undefined);

    await expect(updateStoreMerchandiseAction("merch-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store",
    );

    expect(mocks.uploadStoreProductImage).toHaveBeenCalledWith({
      productId: "merch-1",
      uploadedById: "admin-1",
      file: image,
    });
    expect(mocks.updateAdminStoreMerchandise).toHaveBeenCalledWith(
      "merch-1",
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.setAdminStoreProductActiveState).toHaveBeenCalledWith("merch-1", true);
  });

  it("unlinks merchandise image on edit when requested", async () => {
    const form = makeForm({ ...baseForm, removeImage: "on" });
    mocks.updateAdminStoreMerchandise.mockResolvedValue(undefined);

    await expect(updateStoreMerchandiseAction("merch-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store",
    );

    expect(mocks.unlinkStoreProductImage).toHaveBeenCalledWith("merch-1");
    expect(mocks.uploadStoreProductImage).not.toHaveBeenCalled();
  });

  it("leaves edited merchandise inactive when image upload fails", async () => {
    const image = new File([new Uint8Array([0xff])], "mat.jpg", { type: "image/jpeg" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.updateAdminStoreMerchandise.mockResolvedValue(undefined);
    mocks.uploadStoreProductImage.mockRejectedValue(new Error("IMAGE_WRITE_FAILED"));

    await expect(updateStoreMerchandiseAction("merch-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit",
    );

    expect(mocks.updateAdminStoreMerchandise).toHaveBeenCalledWith(
      "merch-1",
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.setAdminStoreProductActiveState).not.toHaveBeenCalled();
  });

  it("keeps gift-card create flow and returns to unified Store", async () => {
    mocks.createAdminStoreGiftCardProduct.mockResolvedValue({ id: "gift-1" });

    await expect(createStoreGiftCardAction(makeForm(baseForm))).rejects.toThrow("NEXT_REDIRECT:/admin/store");

    expect(mocks.createAdminStoreGiftCardProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Store Item", unitAmountMinor: 2500, isActive: true }),
    );
  });

  it("uploads gift-card image after product creation", async () => {
    const image = new File([new Uint8Array([0x89])], "gift.png", { type: "image/png" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.createAdminStoreGiftCardProduct.mockResolvedValue({ id: "gift-1" });

    await expect(createStoreGiftCardAction(form)).rejects.toThrow("NEXT_REDIRECT:/admin/store");

    expect(mocks.uploadStoreProductImage).toHaveBeenCalledWith({
      productId: "gift-1",
      uploadedById: "admin-1",
      file: image,
    });
    expect(mocks.createAdminStoreGiftCardProduct).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.setAdminStoreProductActiveState).toHaveBeenCalledWith("gift-1", true);
  });

  it("keeps gift-card edit flow and returns to unified Store", async () => {
    mocks.updateAdminStoreGiftCardProduct.mockResolvedValue(undefined);

    await expect(updateStoreGiftCardAction("gift-1", makeForm(baseForm))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store",
    );

    expect(mocks.updateAdminStoreGiftCardProduct).toHaveBeenCalledWith(
      "gift-1",
      expect.objectContaining({ name: "Store Item", unitAmountMinor: 2500, isArchived: false }),
    );
  });

  it("replaces gift-card image on edit", async () => {
    const image = new File([new Uint8Array([0xff])], "gift.jpg", { type: "image/jpeg" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.updateAdminStoreGiftCardProduct.mockResolvedValue(undefined);

    await expect(updateStoreGiftCardAction("gift-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store",
    );

    expect(mocks.updateAdminStoreGiftCardProduct).toHaveBeenCalledWith(
      "gift-1",
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.uploadStoreProductImage).toHaveBeenCalledWith({
      productId: "gift-1",
      uploadedById: "admin-1",
      file: image,
    });
    expect(mocks.setAdminStoreProductActiveState).toHaveBeenCalledWith("gift-1", true);
  });

  it("unlinks gift-card image on edit when requested", async () => {
    const form = makeForm({ ...baseForm, removeImage: "on" });
    mocks.updateAdminStoreGiftCardProduct.mockResolvedValue(undefined);

    await expect(updateStoreGiftCardAction("gift-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store",
    );

    expect(mocks.unlinkStoreProductImage).toHaveBeenCalledWith("gift-1");
    expect(mocks.uploadStoreProductImage).not.toHaveBeenCalled();
  });

  it("leaves edited gift card inactive when image upload fails", async () => {
    const image = new File([new Uint8Array([0xff])], "gift.jpg", { type: "image/jpeg" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.updateAdminStoreGiftCardProduct.mockResolvedValue(undefined);
    mocks.uploadStoreProductImage.mockRejectedValue(new Error("IMAGE_WRITE_FAILED"));

    await expect(updateStoreGiftCardAction("gift-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/gift-cards/gift-1/edit",
    );

    expect(mocks.updateAdminStoreGiftCardProduct).toHaveBeenCalledWith(
      "gift-1",
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.setAdminStoreProductActiveState).not.toHaveBeenCalled();
  });

  it("blocks image mutation when admin authentication fails", async () => {
    const form = makeForm(baseForm);
    form.set("image", new File([new Uint8Array([0x89])], "gift.png", { type: "image/png" }));
    mocks.requireAdminSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    await expect(createStoreGiftCardAction(form)).rejects.toThrow("UNAUTHORIZED");

    expect(mocks.createAdminStoreGiftCardProduct).not.toHaveBeenCalled();
    expect(mocks.uploadStoreProductImage).not.toHaveBeenCalled();
  });

  it("blocks image mutation when non-admin access is rejected", async () => {
    const form = makeForm(baseForm);
    form.set("image", new File([new Uint8Array([0x89])], "gift.png", { type: "image/png" }));
    mocks.requireAdminSession.mockRejectedValue(new Error("FORBIDDEN_NON_ADMIN"));

    await expect(updateStoreGiftCardAction("gift-1", form)).rejects.toThrow("FORBIDDEN_NON_ADMIN");

    expect(mocks.updateAdminStoreGiftCardProduct).not.toHaveBeenCalled();
    expect(mocks.uploadStoreProductImage).not.toHaveBeenCalled();
  });

  it("surfaces a friendly image-too-large message for gift-card edits", async () => {
    const image = new File([new Uint8Array([0xff])], "gift.jpg", { type: "image/jpeg" });
    const form = makeForm(baseForm);
    form.set("image", image);
    mocks.updateAdminStoreGiftCardProduct.mockResolvedValue(undefined);
    mocks.validateProductImageUpload.mockRejectedValue(
      new ProductMediaError("IMAGE_TOO_LARGE", "File exceeds the allowed size."),
    );

    await expect(updateStoreGiftCardAction("gift-1", form)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/gift-cards/gift-1/edit",
    );

    expect(redirectMock.mock.calls[0][0]).toContain(
      encodeURIComponent("Image exceeds the 5 MB upload limit."),
    );
  });
});

// ---------------------------------------------------------------------------
// Retry Stripe sync actions
// ---------------------------------------------------------------------------

const pendingPriceRow = {
  id: "price-pending-1",
  name: "Test Item",
  lookupKey: "store-merch-test-abc",
  priceType: "ONE_TIME",
  currencyCode: "EUR",
  unitAmountMinor: 2500,
  billingInterval: null,
  billingIntervalCount: null,
  stripePriceId: null,
  stripeSyncStatus: "PENDING",
  stripeSyncError: null,
  isActive: true,
  isArchived: false,
};

describe("retryStoreMerchandiseSyncAction", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.assertSameOriginServerAction.mockResolvedValue(undefined);
    mocks.getAdminStoreMerchandiseById.mockReset();
    mocks.attemptStorePriceSyncFromEnv.mockReset();
  });

  it("redirects with success=STRIPE_SYNCED on successful sync", async () => {
    mocks.getAdminStoreMerchandiseById.mockResolvedValue({
      id: "merch-1",
      primaryPrice: pendingPriceRow,
      isCheckoutReady: false,
    });
    mocks.attemptStorePriceSyncFromEnv.mockResolvedValue({
      synced: true,
      stripePriceId: "price_test_synced",
      created: true,
    });

    await expect(retryStoreMerchandiseSyncAction("merch-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit?success=STRIPE_SYNCED",
    );
    expect(mocks.attemptStorePriceSyncFromEnv).toHaveBeenCalledWith("price-pending-1");
  });

  it("redirects with error on sync failure", async () => {
    mocks.getAdminStoreMerchandiseById.mockResolvedValue({
      id: "merch-1",
      primaryPrice: pendingPriceRow,
      isCheckoutReady: false,
    });
    mocks.attemptStorePriceSyncFromEnv.mockResolvedValue({
      synced: false,
      reason: "Stripe network error",
    });

    await expect(retryStoreMerchandiseSyncAction("merch-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit",
    );
    expect(redirectMock.mock.calls[0][0]).toContain("error=");
  });

  it("redirects with STRIPE_NOT_CONFIGURED when Stripe key is absent", async () => {
    mocks.getAdminStoreMerchandiseById.mockResolvedValue({
      id: "merch-1",
      primaryPrice: pendingPriceRow,
      isCheckoutReady: false,
    });
    mocks.attemptStorePriceSyncFromEnv.mockResolvedValue(null);

    await expect(retryStoreMerchandiseSyncAction("merch-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit",
    );
    expect(redirectMock.mock.calls[0][0]).toContain("STRIPE_NOT_CONFIGURED");
  });

  it("redirects with NO_ACTIVE_PRICE when product has no price", async () => {
    mocks.getAdminStoreMerchandiseById.mockResolvedValue({
      id: "merch-1",
      primaryPrice: null,
      isCheckoutReady: false,
    });

    await expect(retryStoreMerchandiseSyncAction("merch-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/merchandise/merch-1/edit",
    );
    expect(redirectMock.mock.calls[0][0]).toContain("NO_ACTIVE_PRICE");
    expect(mocks.attemptStorePriceSyncFromEnv).not.toHaveBeenCalled();
  });
});

describe("retryStoreGiftCardSyncAction", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.assertSameOriginServerAction.mockResolvedValue(undefined);
    mocks.getAdminStoreGiftCardById.mockReset();
    mocks.attemptStorePriceSyncFromEnv.mockReset();
  });

  it("redirects with success=STRIPE_SYNCED on successful sync", async () => {
    mocks.getAdminStoreGiftCardById.mockResolvedValue({
      id: "gc-1",
      activePrice: pendingPriceRow,
      isCheckoutReady: false,
    });
    mocks.attemptStorePriceSyncFromEnv.mockResolvedValue({
      synced: true,
      stripePriceId: "price_test_synced_gc",
      created: true,
    });

    await expect(retryStoreGiftCardSyncAction("gc-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/gift-cards/gc-1/edit?success=STRIPE_SYNCED",
    );
    expect(mocks.attemptStorePriceSyncFromEnv).toHaveBeenCalledWith("price-pending-1");
  });

  it("redirects with error on sync failure", async () => {
    mocks.getAdminStoreGiftCardById.mockResolvedValue({
      id: "gc-1",
      activePrice: pendingPriceRow,
      isCheckoutReady: false,
    });
    mocks.attemptStorePriceSyncFromEnv.mockResolvedValue({
      synced: false,
      reason: "Stripe validation error",
    });

    await expect(retryStoreGiftCardSyncAction("gc-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/gift-cards/gc-1/edit",
    );
    expect(redirectMock.mock.calls[0][0]).toContain("error=");
  });

  it("redirects with NO_ACTIVE_PRICE when gift card has no price", async () => {
    mocks.getAdminStoreGiftCardById.mockResolvedValue({
      id: "gc-1",
      activePrice: null,
      isCheckoutReady: false,
    });

    await expect(retryStoreGiftCardSyncAction("gc-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/gift-cards/gc-1/edit",
    );
    expect(redirectMock.mock.calls[0][0]).toContain("NO_ACTIVE_PRICE");
    expect(mocks.attemptStorePriceSyncFromEnv).not.toHaveBeenCalled();
  });

  it("redirects with STRIPE_NOT_CONFIGURED when Stripe key is absent", async () => {
    mocks.getAdminStoreGiftCardById.mockResolvedValue({
      id: "gc-1",
      activePrice: pendingPriceRow,
      isCheckoutReady: false,
    });
    mocks.attemptStorePriceSyncFromEnv.mockResolvedValue(null);

    await expect(retryStoreGiftCardSyncAction("gc-1")).rejects.toThrow(
      "NEXT_REDIRECT:/admin/store/gift-cards/gc-1/edit",
    );
    expect(redirectMock.mock.calls[0][0]).toContain("STRIPE_NOT_CONFIGURED");
  });
});
