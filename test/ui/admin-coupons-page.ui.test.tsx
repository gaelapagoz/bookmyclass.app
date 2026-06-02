/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { CouponDiscountType, CouponStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  listAdminCoupons: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/coupons/coupon-admin-service", () => ({
  listAdminCoupons: mocks.listAdminCoupons,
}));

import AdminCouponsPage from "../../src/app/admin/(private)/coupons/page";

describe("admin coupons page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.listAdminCoupons.mockResolvedValue([]);
  });

  it("renders create form and heading", async () => {
    render(await AdminCouponsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Catalog: Coupons" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Create Coupon" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Create coupon" })).toBeVisible();
    expect(screen.getByText("No coupons found.")).toBeVisible();
  });

  it("renders existing coupon rows with status actions", async () => {
    mocks.listAdminCoupons.mockResolvedValue([
      {
        id: "cp_1",
        code: "SAVE10",
        name: "Save 10",
        description: "Seasonal discount",
        status: CouponStatus.ACTIVE,
        discountType: CouponDiscountType.PERCENTAGE,
        discountPercentBps: 1000,
        discountAmountMinor: null,
        currencyCode: null,
        startsAt: null,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        minOrderAmountMinor: null,
        maxTotalRedemptions: null,
        maxRedemptionsPerClient: null,
        archivedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    render(await AdminCouponsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("SAVE10")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Activate" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
  });

  it("renders success and error banners from search params", async () => {
    render(
      await AdminCouponsPage({
        searchParams: Promise.resolve({
          success: "Coupon created.",
          error: "Duplicate coupon code.",
        }),
      }),
    );

    expect(screen.getByText("Coupon created.")).toBeVisible();
    expect(screen.getByText("Duplicate coupon code.")).toBeVisible();
  });
});
