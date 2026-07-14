/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/dashboard/dashboard-service", () => ({
  getDashboardHomeData: vi.fn(),
}));

vi.mock("@/lib/loyalty/loyalty-program-service", () => ({
  resolvePrimaryLoyaltyCurrencyCode: vi.fn(),
}));

vi.mock("@/lib/loyalty/loyalty-read-service", () => ({
  getClientLoyaltySummary: vi.fn(),
  listClientLoyaltyHistory: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardHomeData } from "@/lib/dashboard/dashboard-service";
import { resolvePrimaryLoyaltyCurrencyCode } from "@/lib/loyalty/loyalty-program-service";
import { getClientLoyaltySummary, listClientLoyaltyHistory } from "@/lib/loyalty/loyalty-read-service";
import DashboardPage from "../../src/app/(protected)/dashboard/page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders core dashboard summary cards", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      user: { id: "client-1" },
    } as Awaited<ReturnType<typeof requireAuth>>);
    vi.mocked(resolvePrimaryLoyaltyCurrencyCode).mockResolvedValue("EUR");
    vi.mocked(getDashboardHomeData).mockResolvedValue({
      userName: "Client",
      nextUpcomingBooking: null,
      activeSubscription: null,
      creditsLeft: 7,
      recentBookings: [],
    });
    vi.mocked(getClientLoyaltySummary).mockResolvedValue({
      client: { id: "client-1", name: "Client", email: "client@example.test" },
      program: {
        currencyCode: "EUR",
        isActive: true,
        earningPoints: 1,
        earningAmountMinor: 100,
        pointsExpireAfterDays: 180,
        expirationReminderDays: 30,
      },
      balancePoints: 120,
      lifetimeEarnedPoints: 120,
      manualGrantPoints: 0,
      reversedPoints: 0,
      expiredPoints: 0,
      expiringPoints: 40,
      nextExpirationAt: new Date("2026-08-01T10:00:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
    });
    vi.mocked(listClientLoyaltyHistory).mockResolvedValue([
      {
        id: "ledger-1",
        entryType: "EARN",
        amountPoints: 32,
        currencyCode: "EUR",
        orderId: "order-1",
        paymentId: "payment-1",
        sourceEntryId: null,
        reason: "Settled purchase",
        metadata: null,
        happenedAt: new Date("2026-06-18T10:00:00.000Z"),
        expiresAt: null,
        createdAt: new Date("2026-06-18T10:00:00.000Z"),
        createdBy: null,
        sourceEntry: null,
      },
    ]);

    render(await DashboardPage());

    expect(screen.getByText("Client Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Booking")).toBeInTheDocument();
    expect(screen.getByText("Active Membership")).toBeInTheDocument();
    expect(screen.getByText("Class Credits")).toBeInTheDocument();
    expect(screen.getByText("Points Balance")).toBeInTheDocument();
    expect(screen.getByText("Recent Rewards Activity")).toBeInTheDocument();
    expect(screen.getByText("Points Earned")).toBeInTheDocument();
    expect(screen.getByText("+32 pts")).toBeInTheDocument();
  });
});
