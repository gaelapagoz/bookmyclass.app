/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/admin-service", () => ({
  getAdminDashboardData: vi.fn(),
  getAdminClassesData: vi.fn(),
  getAdminSessionsData: vi.fn(),
  getAdminPlansData: vi.fn(),
  getAdminBookingsData: vi.fn(),
  getAdminUsersData: vi.fn(),
  getAdminSubscriptionsData: vi.fn(),
  getAdminLearningProgramsData: vi.fn(),
  getAdminLearningVideosData: vi.fn(),
}));

import {
  getAdminBookingsData,
  getAdminClassesData,
  getAdminDashboardData,
  getAdminLearningProgramsData,
  getAdminLearningVideosData,
  getAdminPlansData,
  getAdminSessionsData,
  getAdminSubscriptionsData,
  getAdminUsersData,
} from "@/lib/admin/admin-service";

import AdminDashboardPage from "../../src/app/admin/(private)/dashboard/page";
import AdminClassesPage from "../../src/app/admin/(private)/classes/page";
import AdminSessionsPage from "../../src/app/admin/(private)/sessions/page";
import AdminPlansPage from "../../src/app/admin/(private)/plans/page";
import AdminBookingsPage from "../../src/app/admin/(private)/bookings/page";
import AdminUsersPage from "../../src/app/admin/(private)/users/page";
import AdminSubscriptionsPage from "../../src/app/admin/(private)/subscriptions/page";
import AdminLearningProgramsPage from "../../src/app/admin/(private)/learning-programs/page";
import AdminLearningVideosPage from "../../src/app/admin/(private)/learning-videos/page";

describe("Admin pages branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dashboard data state", async () => {
    vi.mocked(getAdminDashboardData).mockResolvedValue({
      upcomingSessionsCount: 4,
      bookingsCount: 22,
      activePlansCount: 5,
      activeEntitlementsCount: 11,
      recentBookings: [
        {
          id: "b1",
          status: "CONFIRMED",
          bookedAt: new Date().toISOString(),
          clientName: "Jane",
          clientEmail: "jane@example.test",
          sessionTitle: "Morning Flow",
          startsAt: new Date().toISOString(),
        },
      ],
    });

    render(await AdminDashboardPage());

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Morning Flow")).toBeInTheDocument();
  });

  it("renders classes empty state", async () => {
    vi.mocked(getAdminClassesData).mockResolvedValue([]);

    render(await AdminClassesPage());

    expect(screen.getByText("No classes found.")).toBeInTheDocument();
  });

  it("renders sessions error state", async () => {
    vi.mocked(getAdminSessionsData).mockRejectedValue(new Error("DB error"));

    render(
      await AdminSessionsPage({
        searchParams: Promise.resolve({ week: "2026-03-23" }),
      }),
    );

    expect(screen.getByText("Unable to load sessions right now.")).toBeInTheDocument();
  });

  it("renders plans data with clear pricing/billing columns", async () => {
    vi.mocked(getAdminPlansData).mockResolvedValue([
      {
        id: "p1",
        name: "Unlimited Monthly",
        productType: "UNLIMITED_MEMBERSHIP",
        isActive: true,
        sortOrder: 1,
        currentPriceAmountMinor: 8900,
        currentPriceCurrencyCode: "EUR",
        currentPriceType: "RECURRING",
        currentBillingInterval: "MONTH",
        currentBillingIntervalCount: 1,
        isCheckoutReady: true,
      },
    ]);

    render(await AdminPlansPage());

    expect(screen.getByText("Unlimited Monthly")).toBeInTheDocument();
    expect(screen.getByText("Current Price")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText(/89\.00/)).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create plan" })).toBeInTheDocument();
  });

  it("renders plans empty state", async () => {
    vi.mocked(getAdminPlansData).mockResolvedValue([]);

    render(await AdminPlansPage());

    expect(screen.getByText("No plans found.")).toBeInTheDocument();
  });

  it("renders plans error state", async () => {
    vi.mocked(getAdminPlansData).mockRejectedValue(new Error("DB error"));

    render(await AdminPlansPage());

    expect(screen.getByText("Unable to load plans right now.")).toBeInTheDocument();
  });

  it("renders bookings data state", async () => {
    vi.mocked(getAdminBookingsData).mockResolvedValue([
      {
        id: "b1",
        status: "CONFIRMED",
        paymentSelection: "SINGLE_SESSION",
        bookedAt: new Date().toISOString(),
        customerName: "Jane",
        customerEmail: "jane@example.test",
        sessionTitle: "Morning Flow",
        startsAt: new Date().toISOString(),
      },
    ]);

    render(await AdminBookingsPage());

    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("Morning Flow")).toBeInTheDocument();
  });

  it("renders users data with create link", async () => {
    vi.mocked(getAdminUsersData).mockResolvedValue([
      {
        id: "u1",
        name: "Admin User",
        email: "admin@example.test",
        role: "ADMIN",
        isActive: true,
        lastLoginAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    render(await AdminUsersPage());

    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create user" })).toBeInTheDocument();
  });

  it("renders subscriptions data state", async () => {
    vi.mocked(getAdminSubscriptionsData).mockResolvedValue([
      {
        id: "s1",
        clientName: "Client A",
        clientEmail: "client@example.test",
        productName: "Monthly Unlimited",
        priceName: "Monthly",
        status: "ACTIVE",
        startsAt: new Date().toISOString(),
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        endedAt: null,
        provider: "STRIPE",
      },
    ]);

    render(await AdminSubscriptionsPage());

    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create subscription" })).toBeInTheDocument();
  });

  it("renders subscriptions empty state", async () => {
    vi.mocked(getAdminSubscriptionsData).mockResolvedValue([]);

    render(await AdminSubscriptionsPage());

    expect(screen.getByText("No subscriptions found.")).toBeInTheDocument();
  });

  it("renders subscriptions error state", async () => {
    vi.mocked(getAdminSubscriptionsData).mockRejectedValue(new Error("DB error"));

    render(await AdminSubscriptionsPage());

    expect(screen.getByText("Unable to load subscriptions right now.")).toBeInTheDocument();
  });

  it("renders learning programs data from service", async () => {
    vi.mocked(getAdminLearningProgramsData).mockResolvedValue([
      {
        id: "lp1",
        legacyId: "1",
        courseType: "Yoga",
        mainTitle: "Yoga Program",
        title: "Yoga Basics",
        updatedAt: new Date().toISOString(),
      },
    ]);

    render(await AdminLearningProgramsPage());

    expect(screen.getByRole("heading", { name: "Learning Programs" })).toBeInTheDocument();
    expect(screen.getByText("Yoga Program")).toBeInTheDocument();
  });

  it("renders learning videos data from service", async () => {
    vi.mocked(getAdminLearningVideosData).mockResolvedValue([
      {
        id: "lv1",
        legacyId: "101",
        title: "Core Burn",
        category: "Yoga",
        categoryType: "Flow",
        categoryLevel: "Beginner",
        priority: 1,
        updatedAt: new Date().toISOString(),
      },
    ]);

    render(await AdminLearningVideosPage());

    expect(screen.getByRole("heading", { name: "Learning Videos" })).toBeInTheDocument();
    expect(screen.getByText("Core Burn")).toBeInTheDocument();
  });

  it("renders learning videos empty state", async () => {
    vi.mocked(getAdminLearningVideosData).mockResolvedValue([]);

    render(await AdminLearningVideosPage());

    expect(screen.getByText("No learning videos found.")).toBeInTheDocument();
  });

  it("renders learning programs error state", async () => {
    vi.mocked(getAdminLearningProgramsData).mockRejectedValue(new Error("DB error"));

    render(await AdminLearningProgramsPage());

    expect(screen.getByText("Unable to load learning programs right now.")).toBeInTheDocument();
  });
});


