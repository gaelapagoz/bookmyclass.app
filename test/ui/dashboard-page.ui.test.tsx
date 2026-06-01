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

import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardHomeData } from "@/lib/dashboard/dashboard-service";
import DashboardPage from "../../src/app/(protected)/dashboard/page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders core dashboard summary cards", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      user: { id: "client-1" },
    } as Awaited<ReturnType<typeof requireAuth>>);
    vi.mocked(getDashboardHomeData).mockResolvedValue({
      userName: "Client",
      nextUpcomingBooking: null,
      activeSubscription: null,
      creditsLeft: 7,
      recentBookings: [],
    });

    render(await DashboardPage());

    expect(screen.getByText("Client Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Booking")).toBeInTheDocument();
    expect(screen.getByText("Active Membership")).toBeInTheDocument();
    expect(screen.getByText("Credits Left")).toBeInTheDocument();
  });
});
