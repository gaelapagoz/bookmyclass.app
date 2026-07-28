/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { CouponDiscountType, CouponStatus, Role } from "@prisma/client";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

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

  it("renders list-first heading and empty state", async () => {
    render(await AdminCouponsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Coupons" })).toBeVisible();
    expect(
      screen.getByText("Create and manage discount codes, eligibility rules, validity periods, and redemption limits."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View redemptions" })).toHaveAttribute("href", "/admin/sales/coupons");
    expect(screen.getByRole("link", { name: "Create coupon" })).toHaveAttribute("href", "/admin/coupons/new");
    expect(screen.queryByText("Catalog: Coupons")).not.toBeInTheDocument();
    expect(screen.queryByText("Create, edit, activate, deactivate, and archive in-app coupons.")).not.toBeInTheDocument();
    expect(screen.getByText("No coupons created yet.")).toBeVisible();
  });

  it("renders existing coupon rows in a catalog-style table", async () => {
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

    expect(screen.getByText("Coupon name")).toBeVisible();
    expect(screen.getByText("Coupon code")).toBeVisible();
    expect(screen.getByText("Discount value")).toBeVisible();
    expect(screen.getByText("SAVE10")).toBeVisible();
    expect(screen.getByText("Save 10")).toBeVisible();
    expect(screen.getByText("Percentage")).toBeVisible();
    expect(screen.getByText("10%")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/admin/coupons/cp_1/edit");
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
