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
}));

vi.mock("@/lib/store/store-stripe-sync-service", () => ({
  attemptStorePriceSyncFromEnv: mocks.attemptStorePriceSyncFromEnv,
}));

import {
  createStoreGiftCardAction,
  createStoreMerchandiseAction,
  updateStoreGiftCardAction,
  updateStoreMerchandiseAction,
  retryStoreMerchandiseSyncAction,
  retryStoreGiftCardSyncAction,
} from "../../src/app/admin/(private)/store-actions";

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
    mocks.attemptStorePriceSyncFromEnv.mockReset();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.assertSameOriginServerAction.mockResolvedValue(undefined);
  });

  it("keeps merchandise create flow and returns to unified Store", async () => {
    mocks.createAdminStoreMerchandise.mockResolvedValue({ id: "merch-1" });

    await expect(createStoreMerchandiseAction(makeForm(baseForm))).rejects.toThrow("NEXT_REDIRECT:/admin/store");

    expect(mocks.createAdminStoreMerchandise).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Store Item", unitAmountMinor: 2500, isActive: true }),
    );
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

  it("keeps gift-card create flow and returns to unified Store", async () => {
    mocks.createAdminStoreGiftCardProduct.mockResolvedValue({ id: "gift-1" });

    await expect(createStoreGiftCardAction(makeForm(baseForm))).rejects.toThrow("NEXT_REDIRECT:/admin/store");

    expect(mocks.createAdminStoreGiftCardProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Store Item", unitAmountMinor: 2500, isActive: true }),
    );
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
