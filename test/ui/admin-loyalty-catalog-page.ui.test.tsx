/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Role } from "@prisma/client";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  getAdminLoyaltyOverview: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/loyalty/loyalty-admin-service", () => ({
  getAdminLoyaltyOverview: mocks.getAdminLoyaltyOverview,
}));

vi.mock("../../src/app/admin/(private)/sales/loyalty/actions", () => ({
  saveLoyaltyProgramAction: vi.fn(),
  saveLoyaltyRewardAction: vi.fn(),
  archiveLoyaltyRewardAction: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AdminCatalogLoyaltyPage from "../../src/app/admin/(private)/loyalty/page";

function makeOverview() {
  return {
    metrics: {
      totalClients: 1,
      totalEarnedPoints: 100,
      totalManualGrantPoints: 20,
      totalBalancePoints: 120,
    },
    currencyCode: "EUR",
    programs: [],
    program: {
      id: "program-1",
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 365,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5000,
      rewardDefinitions: [
        {
          id: "reward-1",
          name: "5 EURO Reward",
          pointsRequired: 500,
          amountMinor: 500,
          isActive: true,
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      ],
      eligibleProducts: [{ productId: "product-1" }],
    },
    eligibleProducts: [
      {
        id: "product-1",
        name: "Studio Tote",
        slug: "studio-tote",
        productType: "MERCHANDISE",
        priceId: "price-1",
        priceName: "Studio Tote EUR",
        unitAmountMinor: 2500,
        currencyCode: "EUR",
      },
    ],
    clients: {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
      query: "",
    },
    selectedClient: null,
  };
}

describe("admin loyalty catalog page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.getAdminLoyaltyOverview.mockResolvedValue(makeOverview());
  });

  it("renders loyalty settings under catalog with modal-based editing", async () => {
    const { container } = render(await AdminCatalogLoyaltyPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Loyalty Program" })).toBeVisible();
    expect(
      screen.getByText("Configure how clients earn points, when points expire, and which rewards are available."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "View activity" })).toHaveAttribute("href", "/admin/sales/loyalty");
    expect(screen.getByRole("heading", { name: "Points" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Rewards" })).toBeVisible();
    expect(screen.getByText(/eligible non-recurring catalog products/i)).toBeVisible();
    expect(screen.getByText("5 EURO Reward")).toBeVisible();
    expect(screen.queryByText("Stage 1 Scope Lock")).not.toBeInTheDocument();
    expect(screen.queryByText(/Manual grant ceiling/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Max manual grant points/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[name="maxManualGrantPoints"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Edit purchase earning" })).toBeVisible();
    expect(screen.getByLabelText("Points awarded")).toHaveValue(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1] as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Edit points expiration" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2] as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Edit reward" })).toBeVisible();
    expect(screen.getByLabelText("Reward name")).toHaveValue("5 EURO Reward");
  });
});
