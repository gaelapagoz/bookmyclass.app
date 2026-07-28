/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { CouponRedemptionStatus, Role } from "@prisma/client";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  listAdminCouponUsageHistory: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/coupons/coupon-admin-service", () => ({
  listAdminCouponUsageHistory: mocks.listAdminCouponUsageHistory,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AdminCouponSalesPage from "../../src/app/admin/(private)/sales/coupons/page";

const usageDate = new Date("2026-01-01T10:00:00.000Z");

function mockUsageHistory(items: unknown[] = []) {
  mocks.listAdminCouponUsageHistory.mockResolvedValue({
    items,
    page: 1,
    pageSize: 20,
    totalItems: items.length,
    totalPages: 1,
    status: "ALL",
    query: "",
  });
}

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

describe("admin coupon sales page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.listAdminCouponUsageHistory.mockReset();
    mockUsageHistory();
  });

  it("renders empty coupon usage history state", async () => {
    render(await AdminCouponSalesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Coupon Redemptions" })).toBeVisible();
    expect(screen.getByText("Track coupon redemptions, discounts applied, and related orders.")).toBeVisible();
    expect(screen.queryByText(/Read-only coupon redemption history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gift Card wallet history remains under Sales/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage coupons" })).toHaveAttribute("href", "/admin/coupons");
    expect(screen.getByText("No coupon usage found.")).toBeVisible();
  });

  it("passes search and status filters to the coupon usage service", async () => {
    render(
      await AdminCouponSalesPage({
        searchParams: Promise.resolve({ q: "save10", status: CouponRedemptionStatus.APPLIED, page: "2" }),
      }),
    );

    expect(mocks.listAdminCouponUsageHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 20,
        query: "save10",
        status: CouponRedemptionStatus.APPLIED,
      }),
    );
  });

  it("renders coupon usage rows and Stripe session references", async () => {
    mockUsageHistory([
      {
        id: "redemption-1",
        status: CouponRedemptionStatus.APPLIED,
        couponCode: "SAVE10",
        couponName: "Save 10",
        clientName: "Client One",
        clientEmail: "client@example.test",
        subtotalBeforeMinor: 5_000,
        discountAmountMinor: 500,
        totalAfterMinor: 4_500,
        currencyCode: "EUR",
        orderId: "order-1",
        orderStatus: "PAID",
        paymentId: "payment-1",
        paymentStatus: "SUCCEEDED",
        paymentMethod: "CARD",
        paymentProvider: "STRIPE",
        paymentAmountMinor: 4_500,
        stripeCheckoutSessionId: "cs_coupon_usage",
        reservedAt: usageDate,
        appliedAt: usageDate,
        reversedAt: null,
        expiresAt: usageDate,
        createdAt: usageDate,
      },
    ]);

    render(await AdminCouponSalesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("SAVE10")).toBeVisible();
    expect(screen.getByText("client@example.test")).toBeVisible();
    expect(screen.getByText("cs_coupon_usage")).toBeVisible();
    expect(screen.getByText(formatMoney(500, "EUR"))).toBeVisible();
  });

  it("renders zero-value internal manual payments without Stripe session links", async () => {
    mockUsageHistory([
      {
        id: "redemption-zero",
        status: CouponRedemptionStatus.APPLIED,
        couponCode: "ZERO100",
        couponName: null,
        clientName: "Client Zero",
        clientEmail: "zero@example.test",
        subtotalBeforeMinor: 2_000,
        discountAmountMinor: 2_000,
        totalAfterMinor: 0,
        currencyCode: "EUR",
        orderId: "order-zero",
        orderStatus: "PAID",
        paymentId: "payment-zero",
        paymentStatus: "SUCCEEDED",
        paymentMethod: "MANUAL",
        paymentProvider: "INTERNAL",
        paymentAmountMinor: 0,
        stripeCheckoutSessionId: null,
        reservedAt: usageDate,
        appliedAt: usageDate,
        reversedAt: null,
        expiresAt: usageDate,
        createdAt: usageDate,
      },
    ]);

    render(await AdminCouponSalesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("ZERO100")).toBeVisible();
    expect(screen.getByText("Internal manual payment - no Stripe session")).toBeVisible();
    expect(screen.queryByText(/^cs_/)).not.toBeInTheDocument();
  });

  it("falls back safely for invalid status and page query params", async () => {
    render(
      await AdminCouponSalesPage({
        searchParams: Promise.resolve({ status: "NOT_A_STATUS", page: "0", q: "  save10  " }),
      }),
    );

    expect(mocks.listAdminCouponUsageHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        query: "save10",
        status: "ALL",
      }),
    );
  });

  it("renders pagination controls when multiple pages exist", async () => {
    mocks.listAdminCouponUsageHistory.mockResolvedValue({
      items: [
        {
          id: "redemption-1",
          status: CouponRedemptionStatus.APPLIED,
          couponCode: "SAVE10",
          couponName: "Save 10",
          clientName: "Client One",
          clientEmail: "client@example.test",
          subtotalBeforeMinor: 5_000,
          discountAmountMinor: 500,
          totalAfterMinor: 4_500,
          currencyCode: "EUR",
          orderId: "order-1",
          orderStatus: "PAID",
          paymentId: "payment-1",
          paymentStatus: "SUCCEEDED",
          paymentMethod: "CARD",
          paymentProvider: "STRIPE",
          paymentAmountMinor: 4_500,
          stripeCheckoutSessionId: "cs_coupon_usage",
          reservedAt: usageDate,
          appliedAt: usageDate,
          reversedAt: null,
          expiresAt: usageDate,
          createdAt: usageDate,
        },
      ],
      page: 2,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
      status: "ALL",
      query: "",
    });

    render(await AdminCouponSalesPage({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(screen.getByRole("link", { name: "Previous" })).toBeVisible();
  });
});
