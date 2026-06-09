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
  createAdminCoupon: vi.fn(),
  updateAdminCoupon: vi.fn(),
  setAdminCouponStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: mocks.assertSameOriginServerAction,
}));

vi.mock("@/lib/coupons/coupon-admin-service", () => ({
  createAdminCoupon: mocks.createAdminCoupon,
  updateAdminCoupon: mocks.updateAdminCoupon,
  setAdminCouponStatus: mocks.setAdminCouponStatus,
}));

import { createAdminCouponAction } from "../../src/app/admin/(private)/coupons/actions";

function makeForm(input: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(input)) {
    formData.set(key, value);
  }
  return formData;
}

describe("admin coupon actions", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    mocks.requireAdminSession.mockReset();
    mocks.assertSameOriginServerAction.mockReset();
    mocks.createAdminCoupon.mockReset();
    mocks.updateAdminCoupon.mockReset();
    mocks.setAdminCouponStatus.mockReset();
    mocks.requireAdminSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.assertSameOriginServerAction.mockResolvedValue(undefined);
  });

  it("blocks mutation when same-origin enforcement fails", async () => {
    mocks.assertSameOriginServerAction.mockRejectedValueOnce(new Error("CSRF_INVALID_ORIGIN"));

    await expect(
      createAdminCouponAction(
        makeForm({
          code: "SAVE10",
          status: "ACTIVE",
          discountType: "PERCENTAGE",
          discountValue: "10",
          validUntil: "2099-01-01",
        }),
      ),
    ).rejects.toThrow("CSRF_INVALID_ORIGIN");

    expect(mocks.requireAdminSession).not.toHaveBeenCalled();
    expect(mocks.createAdminCoupon).not.toHaveBeenCalled();
  });

  it("maps duplicate normalized code errors to the coupon page banner", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), { code: "P2002" });
    mocks.createAdminCoupon.mockRejectedValueOnce(duplicateError);

    await expect(
      createAdminCouponAction(
        makeForm({
          code: "SAVE10",
          status: "ACTIVE",
          discountType: "PERCENTAGE",
          discountValue: "10",
          validUntil: "2099-01-01",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/coupons?error=A%20coupon%20with%20this%20normalized%20code%20already%20exists.");
  });
});
