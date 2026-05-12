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
}));

import {
  createStoreGiftCardAction,
  createStoreMerchandiseAction,
  updateStoreGiftCardAction,
  updateStoreMerchandiseAction,
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
      expect.objectContaining({ name: "Store Item", isArchived: false }),
    );
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
