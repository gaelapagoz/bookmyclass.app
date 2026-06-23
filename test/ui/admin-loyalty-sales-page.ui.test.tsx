/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Role } from "@prisma/client";
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
  grantLoyaltyPointsAction: vi.fn(),
}));

import AdminLoyaltySalesPage from "../../src/app/admin/(private)/sales/loyalty/page";

function makeOverview() {
  return {
    metrics: {
      totalClients: 1,
      totalEarnedPoints: 100,
      totalManualGrantPoints: 20,
      totalBalancePoints: 120,
    },
    currencyCode: "EUR",
    programs: [
      {
        id: "program-1",
        currencyCode: "EUR",
        isActive: true,
        earningPoints: 1,
        earningAmountMinor: 100,
        pointsExpireAfterDays: 180,
        expirationReminderDays: 30,
        maxManualGrantPoints: 5000,
      },
    ],
    program: {
      id: "program-1",
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5000,
      eligibleProducts: [
        { productId: "product-1" },
      ],
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
      items: [
        {
          id: "client-1",
          name: "Client One",
          email: "client@example.test",
          isActive: true,
          isInactive: false,
          activationStatus: "ACTIVE",
          balancePoints: 120,
          lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      query: "",
    },
    selectedClient: {
      summary: {
        client: { id: "client-1", name: "Client One", email: "client@example.test" },
        balancePoints: 120,
        expiringPoints: 40,
        nextExpirationAt: new Date("2026-08-01T10:00:00.000Z"),
        lifetimeEarnedPoints: 100,
        manualGrantPoints: 20,
        reversedPoints: 0,
        expiredPoints: 0,
      },
      history: [
        {
          id: "entry-1",
          entryType: "MANUAL_GRANT",
          amountPoints: 20,
          reason: "Launch goodwill grant.",
          happenedAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      ],
    },
  };
}

describe("admin loyalty sales page", () => {
  beforeEach(() => {
    mocks.requireAdminSession.mockResolvedValue({
      user: { id: "admin-1", role: Role.ADMIN },
    });
    mocks.getAdminLoyaltyOverview.mockResolvedValue(makeOverview());
  });

  it("renders admin loyalty overview, clients, and selected client history", async () => {
    render(await AdminLoyaltySalesPage({ searchParams: Promise.resolve({ clientId: "client-1" }) }));

    expect(screen.getByRole("heading", { name: "Loyalty Points" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Client balances" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Manual grant" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Selected client" })).toBeVisible();
    expect(screen.getAllByText("Client One")).toHaveLength(2);
    expect(screen.getByText("Launch goodwill grant.")).toBeVisible();
    expect(screen.getByText("Total number of clients")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Manage Program" })).not.toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Give points" }));
    expect(screen.getByRole("dialog", { name: "Manual grant" })).toBeVisible();
    expect(screen.getByLabelText("Client email")).toHaveValue("client@example.test");
  });

  it("renders empty selected-client state when nothing is chosen", async () => {
    mocks.getAdminLoyaltyOverview.mockResolvedValueOnce({
      ...makeOverview(),
      selectedClient: null,
    });

    render(await AdminLoyaltySalesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Select a client to review loyalty history and balances.")).toBeVisible();
  });
});
