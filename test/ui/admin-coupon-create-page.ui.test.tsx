/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { Role } from "@prisma/client";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AdminCouponCreatePage from "../../src/app/admin/(private)/coupons/new/page";

describe("admin coupon create page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
  });

  it("renders the dedicated create form route", async () => {
    render(await AdminCouponCreatePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Create Coupon" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to coupons" })).toHaveAttribute("href", "/admin/coupons");
    expect(screen.getByLabelText("Coupon name")).toBeVisible();
    expect(screen.getByLabelText("Coupon code")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create coupon" })).toBeVisible();
  });
});
