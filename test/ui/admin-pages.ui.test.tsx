/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  uploadAgendaPdfAction: vi.fn(),
  updateClientMessageStatusAction: vi.fn(),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  listClientMessages: vi.fn(async () => []),
}));

vi.mock("@/lib/public-documents/agenda-document-service", () => ({
  getActiveAgendaPdfDocument: vi.fn(async () => null),
}));

vi.mock("@/lib/public-content/home-agenda-service", () => ({
  getHomeAgendaTableFromSchedule: vi.fn(async () => []),
  getManageSiteAgendaPreview: vi.fn(async () => []),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));
vi.mock("@/lib/admin/admin-service", () => ({
  getAdminDashboardData: vi.fn(),
  getAdminDashboardInsights: vi.fn(),
  getOperationalMetricCards: vi.fn(),
  getAdminClassesData: vi.fn(),
  getAdminSessionsData: vi.fn(),
  getAdminPlansData: vi.fn(),
  getAdminBookingsData: vi.fn(),
  getAdminUsersData: vi.fn(),
  getAdminSubscriptionsData: vi.fn(),
  getAdminOnlineLearningData: vi.fn(),
}));

import {
  getAdminBookingsData,
  getAdminClassesData,
  getAdminDashboardData,
  getAdminDashboardInsights,
  getOperationalMetricCards,
  getAdminOnlineLearningData,
  getAdminPlansData,
  getAdminSessionsData,
  getAdminSubscriptionsData,
  getAdminUsersData,
} from "@/lib/admin/admin-service";
import { listClientMessages } from "@/lib/client-messages/client-message-service";
import { getActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";
import {
  getHomeAgendaTableFromSchedule,
  getManageSiteAgendaPreview,
} from "@/lib/public-content/home-agenda-service";

import AdminDashboardPage from "../../src/app/admin/(private)/dashboard/page";
import AdminClassesPage from "../../src/app/admin/(private)/classes/page";
import AdminSessionsPage from "../../src/app/admin/(private)/sessions/page";
import AdminPlansPage from "../../src/app/admin/(private)/plans/page";
import AdminBookingsPage from "../../src/app/admin/(private)/bookings/page";
import AdminUsersPage from "../../src/app/admin/(private)/users/page";
import AdminSubscriptionsPage from "../../src/app/admin/(private)/subscriptions/page";
import AdminOnlineLearningPage from "../../src/app/admin/(private)/online-learning/page";
import AdminInboxPage from "../../src/app/admin/(private)/inbox/page";
import AdminManageSitePage from "../../src/app/admin/(private)/manage-site/page";

describe("Admin pages branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dashboard data state", async () => {
    vi.mocked(getAdminDashboardData).mockResolvedValue({
      upcomingSessions: [
        {
          id: "s1",
          title: "Morning Flow",
          startsAt: new Date().toISOString(),
          bookedSpots: 8,
          capacity: 12,
        },
      ],
    });
    vi.mocked(getOperationalMetricCards).mockResolvedValue([
      {
        key: "siteSessions",
        label: "Site Sessions",
        total: 18,
        previousTotal: 12,
        deltaPercentage: 50,
        currentDailyValue: 3,
        previousDailyValue: 2,
        trendDirection: "up",
        format: "number",
      },
      {
        key: "totalSales",
        label: "Total Sales",
        total: 19900,
        previousTotal: 15000,
        deltaPercentage: 32.7,
        currentDailyValue: 3900,
        previousDailyValue: 2000,
        trendDirection: "up",
        format: "currency",
      },
      {
        key: "totalOrders",
        label: "Total Orders",
        total: 6,
        previousTotal: 4,
        deltaPercentage: 50,
        currentDailyValue: 2,
        previousDailyValue: 1,
        trendDirection: "up",
        format: "number",
      },
      {
        key: "bookings",
        label: "Total Bookings",
        total: 12,
        previousTotal: 10,
        deltaPercentage: 20,
        currentDailyValue: 3,
        previousDailyValue: 2,
        trendDirection: "up",
        format: "number",
      },
      {
        key: "cancellations",
        label: "Total Cancellations",
        total: 2,
        previousTotal: 2,
        deltaPercentage: 0,
        currentDailyValue: 0,
        previousDailyValue: 1,
        trendDirection: "flat",
        format: "number",
      },
    ]);
    vi.mocked(getAdminDashboardInsights).mockResolvedValue({
      topClassSessions: [
        {
          classTemplateId: "tmpl-1",
          classTitle: "Pilates with Props",
          teacherName: "Orsi",
          bookedCount: 28,
          sessionCount: 6,
          averageCapacity: 10,
        },
      ],
      topClients: [
        {
          clientId: "client-1",
          clientName: "Katalin",
          bookedCount: 11,
        },
      ],
      atRiskClients: [
        {
          clientId: "client-risk-1",
          clientName: "Engy Sawah",
          lastBookingAt: new Date().toISOString(),
        },
      ],
      staffPerformance: [
        {
          staffId: "staff-1",
          staffName: "Orsi",
          totalBookedPeople: 62,
          classesDone: 12,
          occupancyRatePercentage: 78.4,
        },
      ],
    });

    render(
      await AdminDashboardPage({
        searchParams: Promise.resolve({ period: "last30Days" }),
      }),
    );

    expect(vi.mocked(getOperationalMetricCards)).toHaveBeenCalledWith("last30Days");
    expect(vi.mocked(getAdminDashboardInsights)).toHaveBeenCalledWith("last30Days");
    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Operational Metrics")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Insights")).toBeInTheDocument();
    expect(screen.getByText("Top Class Sessions")).toBeInTheDocument();
    expect(screen.getByText("Top Clients")).toBeInTheDocument();
    expect(screen.getByText("At-Risk Clients")).toBeInTheDocument();
    expect(screen.getByText("Staff Performance")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByText("Site Sessions")).toBeInTheDocument();
    expect(screen.getByText("Morning Flow")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage Site" })).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard Insights (Last 30 Days)")).not.toBeInTheDocument();
  });

  it("defaults dashboard period to last30Days when missing", async () => {
    vi.mocked(getAdminDashboardData).mockResolvedValue({
      upcomingSessions: [],
    });
    vi.mocked(getAdminDashboardInsights).mockResolvedValue({
      topClassSessions: [],
      topClients: [],
      atRiskClients: [],
      staffPerformance: [],
    });
    vi.mocked(getOperationalMetricCards).mockResolvedValue([]);

    render(
      await AdminDashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(vi.mocked(getOperationalMetricCards)).toHaveBeenCalledWith("last30Days");
    expect(vi.mocked(getAdminDashboardInsights)).toHaveBeenCalledWith("last30Days");
    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
  });


  it("passes last7Days period to metrics and insights", async () => {
    vi.mocked(getAdminDashboardData).mockResolvedValue({
      upcomingSessions: [],
    });
    vi.mocked(getAdminDashboardInsights).mockResolvedValue({
      topClassSessions: [],
      topClients: [],
      atRiskClients: [],
      staffPerformance: [],
    });
    vi.mocked(getOperationalMetricCards).mockResolvedValue([]);

    render(
      await AdminDashboardPage({
        searchParams: Promise.resolve({ period: "last7Days" }),
      }),
    );

    expect(vi.mocked(getOperationalMetricCards)).toHaveBeenCalledWith("last7Days");
    expect(vi.mocked(getAdminDashboardInsights)).toHaveBeenCalledWith("last7Days");
    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
  });

  it("passes last90Days period to metrics and insights", async () => {
    vi.mocked(getAdminDashboardData).mockResolvedValue({
      upcomingSessions: [],
    });
    vi.mocked(getAdminDashboardInsights).mockResolvedValue({
      topClassSessions: [],
      topClients: [],
      atRiskClients: [],
      staffPerformance: [],
    });
    vi.mocked(getOperationalMetricCards).mockResolvedValue([]);

    render(
      await AdminDashboardPage({
        searchParams: Promise.resolve({ period: "last90Days" }),
      }),
    );

    expect(vi.mocked(getOperationalMetricCards)).toHaveBeenCalledWith("last90Days");
    expect(vi.mocked(getAdminDashboardInsights)).toHaveBeenCalledWith("last90Days");
    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
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

    expect(screen.getByText("Admins")).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toBeInTheDocument();
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

  it("renders inbox data and message status controls", async () => {
    vi.mocked(listClientMessages).mockResolvedValue([
      {
        id: "msg-1",
        type: "CONTACT",
        userId: null,
        bookingId: null,
        name: "Jane",
        email: "jane@example.test",
        phone: null,
        subject: "Help",
        message: "Need details",
        status: "NEW",
        createdAt: new Date(),
      },
    ]);

    render(await AdminInboxPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByText(/Jane/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("renders manage site data with agenda sections", async () => {
    vi.mocked(getActiveAgendaPdfDocument).mockResolvedValue({
      id: "doc-1",
      key: "agenda_pdf",
      fileUrl: "/uploads/agenda.pdf",
      isActive: true,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    vi.mocked(getHomeAgendaTableFromSchedule).mockResolvedValue([
      { day: "Monday", classes: ["18:00-19:00 Pilates"] },
    ]);
    vi.mocked(getManageSiteAgendaPreview).mockResolvedValue([
      {
        id: "sess-1",
        title: "Morning Flow",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        bookedSpots: 5,
        capacity: 10,
      },
    ]);

    render(await AdminManageSitePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Manage Site" })).toBeInTheDocument();
    expect(screen.getByText("Agenda PDF")).toBeInTheDocument();
    expect(screen.getByText("Home Agenda Table")).toBeInTheDocument();
    expect(screen.getByText("Morning Flow")).toBeInTheDocument();
  });

  it("renders online learning data from shared service", async () => {
    vi.mocked(getAdminOnlineLearningData).mockResolvedValue({
      programs: [
        {
          id: "lp1",
          legacyId: "1",
          courseType: "Yoga",
          mainTitle: "Yoga Program",
          title: "Yoga Basics",
          updatedAt: new Date().toISOString(),
        },
      ],
      videos: [
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
      ],
    });

    render(await AdminOnlineLearningPage());

    expect(screen.getByRole("heading", { name: "Online Learning" })).toBeInTheDocument();
    expect(screen.getByText("Yoga Program")).toBeInTheDocument();
    expect(screen.getByText("Core Burn")).toBeInTheDocument();
  });

  it("renders online learning empty state", async () => {
    vi.mocked(getAdminOnlineLearningData).mockResolvedValue({ programs: [], videos: [] });

    render(await AdminOnlineLearningPage());

    expect(screen.getByText("No learning programs found.")).toBeInTheDocument();
    expect(screen.getByText("No learning videos found.")).toBeInTheDocument();
  });

  it("renders online learning error state", async () => {
    vi.mocked(getAdminOnlineLearningData).mockRejectedValue(new Error("DB error"));

    render(await AdminOnlineLearningPage());

    expect(screen.getByText("Unable to load online learning right now.")).toBeInTheDocument();
  });
});








