/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  uploadAgendaPdfAction: vi.fn(),
  createClassCategoryAction: vi.fn(),
  createSiteWeeklyScheduleEntryAction: vi.fn(),
  updateSiteWeeklyScheduleEntryAction: vi.fn(),
  deleteSiteWeeklyScheduleEntryAction: vi.fn(),
  updateCancellationPeriodAction: vi.fn(),
  updateSiteTimeZoneAction: vi.fn(),
  updateClientMessageStatusAction: vi.fn(),
  createMarketingSegmentAction: vi.fn(),
  updateMarketingSegmentAction: vi.fn(),
  bulkSetClientMarketingSubscriptionStatusAction: vi.fn(),
  bulkAddClientMarketingSegmentsAction: vi.fn(),
  bulkRemoveClientMarketingSegmentsAction: vi.fn(),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  listClientMessages: vi.fn(async () => []),
}));

vi.mock("@/lib/public-documents/agenda-document-service", () => ({
  getActiveAgendaPdfDocument: vi.fn(async () => null),
}));

vi.mock("@/lib/marketing/marketing-service", () => ({
  listMarketingSegments: vi.fn(),
}));
vi.mock("@/lib/email/email-automation-admin-service", () => ({
  getAutomationScaffoldRows: vi.fn(),
  ensureAllExpectedAutomationTemplatesExist: vi.fn(async () => undefined),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));
vi.mock("@/lib/admin/admin-service", () => ({
  getAdminDashboardData: vi.fn(),
  getAdminDashboardInsights: vi.fn(),  getDashboardTrendData: vi.fn(),
  getOperationalMetricCards: vi.fn(),
  getAdminClassesData: vi.fn(),
  getAdminClassCategoriesData: vi.fn(),
  getAdminSessionsData: vi.fn(),
  getAdminPlansData: vi.fn(),
  getBookings: vi.fn(),
  getAdminAdminsPageData: vi.fn(),
  getAdminTeachersPageData: vi.fn(),
  getAdminClientsPageData: vi.fn(),
  getAdminClientStats: vi.fn(),
  listAdminMarketingSegmentOptions: vi.fn(),
  getAdminSubscriptionsPageData: vi.fn(),
  listAdminSiteWeeklyScheduleEntries: vi.fn(),
  listAdminSiteScheduleServiceOptions: vi.fn(),
  getAdminCancellationPeriodHours: vi.fn(),
  getAdminSiteTimeZone: vi.fn(),
  getAdminOrdersPageData: vi.fn(),
  getAdminOnlineLearningData: vi.fn(),
}));

import {
  getBookings,
  getAdminClassesData,
  getAdminClassCategoriesData,
  getAdminDashboardData,
  getAdminDashboardInsights,  getDashboardTrendData,
  getOperationalMetricCards,
  getAdminOnlineLearningData,
  getAdminPlansData,
  getAdminSessionsData,
  getAdminSubscriptionsPageData,
  getAdminOrdersPageData,
  getAdminAdminsPageData,
  getAdminTeachersPageData,
  getAdminClientsPageData,
  getAdminClientStats,
  listAdminMarketingSegmentOptions,
  listAdminSiteWeeklyScheduleEntries,
  listAdminSiteScheduleServiceOptions,
  getAdminCancellationPeriodHours,
  getAdminSiteTimeZone,
} from "@/lib/admin/admin-service";
import { listMarketingSegments } from "@/lib/marketing/marketing-service";
import { getAutomationScaffoldRows } from "@/lib/email/email-automation-admin-service";
import { listClientMessages } from "@/lib/client-messages/client-message-service";
import { getActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";

import AdminDashboardPage from "../../src/app/admin/(private)/dashboard/page";
import AdminClassesPage from "../../src/app/admin/(private)/classes/page";
import AdminSessionsPage from "../../src/app/admin/(private)/sessions/page";
import AdminPlansPage from "../../src/app/admin/(private)/plans/page";
import AdminBookingsPage from "../../src/app/admin/(private)/bookings/page";
import AdminUsersAdminsPage from "../../src/app/admin/(private)/users/admins/page";
import AdminUsersTeachersPage from "../../src/app/admin/(private)/users/teachers/page";
import AdminUsersClientsPage from "../../src/app/admin/(private)/users/clients/page";
import AdminSubscriptionsPage from "../../src/app/admin/(private)/subscriptions/page";
import AdminOrdersPage from "../../src/app/admin/(private)/orders/page";
import AdminOnlineLearningPage from "../../src/app/admin/(private)/online-learning/page";
import AdminInboxPage from "../../src/app/admin/(private)/inbox/page";
import AdminManageSitePage from "../../src/app/admin/(private)/manage-site/page";
import AdminAutomationsPage from "../../src/app/admin/(private)/automations/page";
import AdminMarketingSegmentsPage from "../../src/app/admin/(private)/marketing/segments/page";
describe("Admin pages branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();    vi.mocked(getDashboardTrendData).mockResolvedValue([]);
    vi.mocked(getAdminClassCategoriesData).mockResolvedValue([]);
    vi.mocked(listAdminMarketingSegmentOptions).mockResolvedValue([]);
    vi.mocked(listMarketingSegments).mockResolvedValue([]);
    vi.mocked(getAutomationScaffoldRows).mockResolvedValue([]);
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
    expect(vi.mocked(getDashboardTrendData)).toHaveBeenCalledWith("last30Days");    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
    expect(screen.getByText("Booking Analytics")).toBeInTheDocument();
    expect(screen.queryByText("Marketing Analytics")).not.toBeInTheDocument();
    expect(screen.getByText("Top Class Sessions")).toBeInTheDocument();
    expect(screen.getByText("Top Clients")).toBeInTheDocument();
    expect(screen.getByText("At-Risk Clients")).toBeInTheDocument();
    expect(screen.getByText("Staff Performance")).toBeInTheDocument();    expect(screen.queryByText("Open rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Click rate")).not.toBeInTheDocument();
    expect(screen.getByText("Total Sales Trend")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByText("Site Sessions")).toBeInTheDocument();
    expect(screen.getByText("Morning Flow")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage Site" })).not.toBeInTheDocument();
    expect(screen.queryByText("Booking Analytics (Last 30 Days)")).not.toBeInTheDocument();
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
    expect(vi.mocked(getDashboardTrendData)).toHaveBeenCalledWith("last30Days");    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
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
    expect(vi.mocked(getDashboardTrendData)).toHaveBeenCalledWith("last7Days");    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
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
    expect(vi.mocked(getDashboardTrendData)).toHaveBeenCalledWith("last90Days");    expect(vi.mocked(getAdminDashboardData)).toHaveBeenCalledWith();
  });
  it("renders classes empty state", async () => {
    vi.mocked(getAdminClassesData).mockResolvedValue([]);

    render(await AdminClassesPage());

    expect(screen.getByRole("heading", { name: "Booking Services" })).toBeInTheDocument();
    expect(screen.getByText("No booking services found.")).toBeInTheDocument();
  });
  it("renders booking services table with required headers and teacher name", async () => {
    vi.mocked(getAdminClassesData).mockResolvedValue([
      {
        id: "class-1",
        name: "Functional Strength",
        categoryName: "Fitness & Functional",
        defaultTeacherName: "Sofia Van den Berg",
        defaultCapacity: 14,
        isActive: true,
        isVisible: true,
        sortOrder: 1,
      },
    ]);

    render(await AdminClassesPage());

    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create category" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Teacher Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Capacity" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Slug" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Duration" })).not.toBeInTheDocument();
    expect(screen.getByText("Sofia Van den Berg")).toBeInTheDocument();
  });

  it("renders teacher fallback when no default teacher exists", async () => {
    vi.mocked(getAdminClassesData).mockResolvedValue([
      {
        id: "class-2",
        name: "Mat Pilates",
        categoryName: "Pilates",
        defaultTeacherName: null,
        defaultCapacity: 10,
        isActive: true,
        isVisible: true,
        sortOrder: 2,
      },
    ]);

    render(await AdminClassesPage());

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("renders sessions error state", async () => {
    vi.mocked(getAdminSessionsData).mockRejectedValue(new Error("DB error"));

    render(
      await AdminSessionsPage({
        searchParams: Promise.resolve({ week: "2026-03-23" }),
      }),
    );

    expect(screen.getByText("Unable to load calendar right now.")).toBeInTheDocument();
  });

  it("renders waitlist count in admin sessions calendar cards without management controls", async () => {
    vi.mocked(getAdminSessionsData).mockResolvedValue([
      {
        id: "session-1",
        title: "Waitlist Session",
        className: "Pilates",
        teacherName: "Teacher One",
        startsAt: new Date("2026-04-14T08:00:00.000Z").toISOString(),
        endsAt: new Date("2026-04-14T09:00:00.000Z").toISOString(),
        location: "Studio A",
        capacity: 12,
        bookedCount: 12,
        waitlistCount: 2,
        status: "SCHEDULED",
        isPublished: true,
      },
      {
        id: "session-2",
        title: "No Waitlist Session",
        className: "Pilates",
        teacherName: "Teacher One",
        startsAt: new Date("2026-04-15T10:00:00.000Z").toISOString(),
        endsAt: new Date("2026-04-15T11:00:00.000Z").toISOString(),
        location: "Studio B",
        capacity: 12,
        bookedCount: 8,
        waitlistCount: 0,
        status: "SCHEDULED",
        isPublished: true,
      },
    ]);

    render(
      await AdminSessionsPage({
        searchParams: Promise.resolve({ week: "2026-04-13" }),
      }),
    );

    expect(screen.getByText("Waitlist: 2")).toBeInTheDocument();
    expect(screen.queryByText("Waitlist: 0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join waitlist/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel waitlist/i })).not.toBeInTheDocument();
  });

  it("renders plans data with clear pricing/billing columns", async () => {
    vi.mocked(getAdminPlansData).mockResolvedValue([
      {
        id: "p1",
        name: "Unlimited Monthly",
        productType: "UNLIMITED_MEMBERSHIP",
        isActive: true,
        sortOrder: 1,
        activeEntitlementQuantity: null,
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
    vi.mocked(getBookings).mockResolvedValue({
      data: [
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
      ],
      totalPages: 2,
    });

    render(await AdminBookingsPage({ searchParams: Promise.resolve({ page: "1", filter: "confirmed", q: "jane" }) }));

    expect(vi.mocked(getBookings)).toHaveBeenCalledWith({ page: 1, pageSize: 20, filter: "confirmed", query: "jane" });
    expect(screen.getByRole("heading", { name: "Booking List" })).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("Morning Flow")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /actions?/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter").compareDocumentPosition(screen.getByLabelText("Search bookings"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  it("renders admins page data with create link", async () => {
    vi.mocked(getAdminAdminsPageData).mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      items: [
        {
          id: "u1",
          name: "Admin User",
          email: "admin@example.test",
          role: "ADMIN",
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
          marketingSegmentNames: [],
        },
      ],
    });

    render(await AdminUsersAdminsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Admins" })).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create user" })).toBeInTheDocument();
  });

  it("renders teachers page data", async () => {
    vi.mocked(getAdminTeachersPageData).mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      items: [
        {
          id: "t1",
          name: "Teacher User",
          email: "teacher@example.test",
          role: "TEACHER",
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
          marketingSegmentNames: [],
        },
      ],
    });

    render(await AdminUsersTeachersPage());

    expect(screen.getByRole("heading", { level: 1, name: "Teachers" })).toBeInTheDocument();
    expect(screen.getByText("Teacher User")).toBeInTheDocument();
  });

  it("renders clients page stats and table", async () => {
    vi.mocked(getAdminClientsPageData).mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      items: [
        {
          id: "c1",
          name: "Client User",
          email: "client@example.test",
          role: "CLIENT",
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          marketingSubscriptionStatus: "SUBSCRIBED",
          marketingSegmentNames: ["VIP"],
        },
      ],
    });
    vi.mocked(getAdminClientStats).mockResolvedValue({
      totalClients: 10,
      neverSubscribedClients: 4,
      subscribedClients: 3,
      unsubscribedClients: 3,
      totalSubscriptions: 9,
    });
    vi.mocked(listAdminMarketingSegmentOptions).mockResolvedValue([{ id: "seg-1", name: "VIP", isActive: true }]);

    render(await AdminUsersClientsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Clients" })).toBeInTheDocument();
    expect(screen.getByText("Total Number of Client")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Client User")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set subscription status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add segments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove segments" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all clients on this page" })).toBeInTheDocument();
  });

  it("selects only rendered clients for current-page bulk actions", async () => {
    vi.mocked(getAdminClientsPageData).mockResolvedValue({
      page: 2,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      items: [
        {
          id: "c2",
          name: "Client Two",
          email: "client2@example.test",
          role: "CLIENT",
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          marketingSubscriptionStatus: "SUBSCRIBED",
          marketingSegmentNames: [],
        },
        {
          id: "c3",
          name: "Client Three",
          email: "client3@example.test",
          role: "CLIENT",
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          marketingSubscriptionStatus: "UNSUBSCRIBED",
          marketingSegmentNames: [],
        },
      ],
    });
    vi.mocked(getAdminClientStats).mockResolvedValue({
      totalClients: 3,
      neverSubscribedClients: 1,
      subscribedClients: 1,
      unsubscribedClients: 1,
      totalSubscriptions: 2,
    });
    vi.mocked(listAdminMarketingSegmentOptions).mockResolvedValue([]);

    render(await AdminUsersClientsPage({ searchParams: Promise.resolve({ page: "2" }) }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all clients on this page" }));

    expect(screen.getByRole("checkbox", { name: "Select client2@example.test" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select client3@example.test" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Select client1@example.test" })).not.toBeInTheDocument();
  });

  it("renders marketing segments CRUD page", async () => {
    vi.mocked(listMarketingSegments).mockResolvedValue([
      {
        id: "seg-1",
        name: "VIP",
        slug: "vip",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 4,
      },
    ]);

    render(await AdminMarketingSegmentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Marketing Segments" })).toBeInTheDocument();
    expect(screen.getByText("Create segment")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Users" })).toBeInTheDocument();
    expect(screen.getAllByText("VIP").length).toBeGreaterThan(0);
  });

  it("renders subscriptions data state", async () => {
    vi.mocked(getAdminSubscriptionsPageData).mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      items: [
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
      ],
    });

    render(await AdminSubscriptionsPage({ searchParams: Promise.resolve({}) }));

    expect(vi.mocked(getAdminSubscriptionsPageData)).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      filter: "all",
      query: "",
    });
    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByText("Client A")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create subscription" })).toBeInTheDocument();
  });

  it("renders subscriptions filter, search, and pagination when more than one page exists", async () => {
    vi.mocked(getAdminSubscriptionsPageData).mockResolvedValue({
      page: 2,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
      items: [
        {
          id: "s2",
          clientName: "Client B",
          clientEmail: "clientb@example.test",
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
      ],
    });

    render(await AdminSubscriptionsPage({ searchParams: Promise.resolve({ page: "2", filter: "active", q: "client" }) }));

    expect(vi.mocked(getAdminSubscriptionsPageData)).toHaveBeenCalledWith({
      page: 2,
      pageSize: 20,
      filter: "active",
      query: "client",
    });
    expect(screen.getByLabelText("Filter").compareDocumentPosition(screen.getByLabelText("Search subscriptions"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/subscriptions?filter=active&q=client&page=1");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/subscriptions?filter=active&q=client&page=3");
  });

  it("renders subscriptions empty state", async () => {
    vi.mocked(getAdminSubscriptionsPageData).mockResolvedValue({
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 1,
      items: [],
    });

    render(await AdminSubscriptionsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("No subscriptions found.")).toBeInTheDocument();
  });

  it("renders subscriptions error state", async () => {
    vi.mocked(getAdminSubscriptionsPageData).mockRejectedValue(new Error("DB error"));

    render(await AdminSubscriptionsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Unable to load subscriptions right now.")).toBeInTheDocument();
  });

  it("renders orders filter then search and pagination state", async () => {
    vi.mocked(getAdminOrdersPageData).mockResolvedValue({
      filter: "last30Days",
      page: 2,
      pageSize: 20,
      totalItems: 41,
      totalPages: 3,
      items: [
        {
          id: "oi-1",
          orderId: "order-1",
          purchasedAt: new Date().toISOString(),
          clientName: "Client A",
          clientEmail: "client@example.test",
          productName: "Pilates Pack",
          priceName: "10 Credits",
          quantity: 1,
          lineTotalAmountMinor: 12900,
          currencyCode: "EUR",
        },
      ],
    });

    render(await AdminOrdersPage({ searchParams: Promise.resolve({ page: "2", filter: "last30Days", q: "client" }) }));

    expect(vi.mocked(getAdminOrdersPageData)).toHaveBeenCalledWith({
      page: 2,
      filter: "last30Days",
      query: "client",
      pageSize: 20,
    });
    expect(screen.getByRole("heading", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter").compareDocumentPosition(screen.getByLabelText("Search orders"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const resetPageInputs = screen
      .getAllByDisplayValue("1")
      .filter((element) => (element as HTMLInputElement).name === "page");
    expect(resetPageInputs.length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Last 30 days")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/admin/orders?page=1&filter=last30Days&q=client",
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/admin/orders?page=3&filter=last30Days&q=client",
    );
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
        contactStatus: "INBOX",
        spamReason: null,
        createdAt: new Date(),
      },
    ]);

    render(await AdminInboxPage({ searchParams: Promise.resolve({}) }));

    expect(vi.mocked(listClientMessages)).toHaveBeenCalledWith({ limit: 50, mailbox: "INBOX" });
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByText(/Jane/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("renders manage site empty-state when no schedule or policy rows exist", async () => {
    vi.mocked(getActiveAgendaPdfDocument).mockResolvedValue(null);
    vi.mocked(listAdminSiteWeeklyScheduleEntries).mockResolvedValue([]);
    vi.mocked(listAdminSiteScheduleServiceOptions).mockResolvedValue([]);
    vi.mocked(getAdminCancellationPeriodHours).mockResolvedValue(24);
    vi.mocked(getAdminSiteTimeZone).mockResolvedValue("Europe/Brussels");

    render(await AdminManageSitePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Manage Site" })).toBeInTheDocument();
    expect(screen.getAllByText("No service").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("24")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Site timezone" })).toHaveValue("Europe/Brussels");
    expect(
      screen.getByText("No booking services exist yet. Create a booking service first, then add agenda schedule rows."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Service" })).toBeDisabled();
    expect(screen.queryByText("Unable to load site management data right now.")).not.toBeInTheDocument();
  });

  it("renders manage site data with static schedule and cancellation config", async () => {
    vi.mocked(getActiveAgendaPdfDocument).mockResolvedValue({
      id: "doc-1",
      key: "agenda_pdf",
      fileUrl: "/uploads/agenda.pdf",
      isActive: true,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    vi.mocked(listAdminSiteWeeklyScheduleEntries).mockResolvedValue([
      {
        id: "site-1",
        dayOfWeek: "MONDAY",
        startTime: "18:00",
        endTime: "19:00",
        serviceId: "service-1",
        label: "Pilates",
        displayOrder: 1,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(listAdminSiteScheduleServiceOptions).mockResolvedValue([
      { id: "service-1", name: "Pilates" },
      { id: "service-2", name: "Functional Strength" },
    ]);
    vi.mocked(getAdminCancellationPeriodHours).mockResolvedValue(24);
    vi.mocked(getAdminSiteTimeZone).mockResolvedValue("America/New_York");

    render(await AdminManageSitePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Manage Site" })).toBeInTheDocument();
    expect(screen.getByText("Agenda PDF")).toBeInTheDocument();
    expect(screen.getByText("Agenda Schedule")).toBeInTheDocument();
    expect(screen.getByText("Configure Cancellation Period")).toBeInTheDocument();
    expect(screen.getByText("Configure Site Timezone")).toBeInTheDocument();
    const serviceSelects = screen.getAllByRole("combobox", { name: "Service" });
    expect(serviceSelects.length).toBeGreaterThan(0);
    expect((serviceSelects[0] as HTMLSelectElement).value).toBe("service-1");
    expect(screen.getAllByRole("option", { name: "Functional Strength" }).length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText("Functional Strength")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("24")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Site timezone" })).toHaveValue("America/New_York");
    expect(screen.getByRole("option", { name: /\(UTC-0[45]:00\) New York/ })).toHaveValue("America/New_York");
  });

  it("renders automations scaffold page", async () => {
    vi.mocked(getAutomationScaffoldRows).mockResolvedValue([
      { templateKey: "booking.welcome", triggerLabel: "Welcome", category: "Lifecycle", subject: "Not configured", previewText: "", whenDescription: "Immediately", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "purchase.product.confirmation", triggerLabel: "Buy Product", category: "Payment", subject: "Not configured", previewText: "", whenDescription: "Immediately on purchase success", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "subscription.cancelled", triggerLabel: "Cancel Subscription", category: "Subscription", subject: "Not configured", previewText: "", whenDescription: "Immediately on cancellation", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "subscription.renewal", triggerLabel: "Renewal Subscription", category: "Subscription", subject: "Not configured", previewText: "", whenDescription: "Immediately on charge success", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "booking.class-booked", triggerLabel: "Booked Class", category: "Booking", subject: "Not configured", previewText: "", whenDescription: "Immediately", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "booking.class-cancelled", triggerLabel: "Class Cancelled", category: "Booking", subject: "Not configured", previewText: "", whenDescription: "Immediately on session cancel", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "booking.class-reminder", triggerLabel: "Class Reminder", category: "Booking", subject: "Not configured", previewText: "", whenDescription: "2x cancellation policy before start", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "waitlist.on-list", triggerLabel: "On Waiting List", category: "Waitlist", subject: "Not configured", previewText: "", whenDescription: "Immediately", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "waitlist.promoted", triggerLabel: "Promoted Waiting List", category: "Waitlist", subject: "Not configured", previewText: "", whenDescription: "Immediately on promotion", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "waitlist.not-promoted", triggerLabel: "Not Promoted Waiting List", category: "Waitlist", subject: "Not configured", previewText: "", whenDescription: "At class start", status: "Draft", marketingStatus: "Never sent", sentLast30Days: 0, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: false },
      { templateKey: "auth.verify-email", triggerLabel: "Auth Verification Email", category: "Auth", subject: "Verify your email", previewText: "", whenDescription: "Immediately after signup", status: "Active", marketingStatus: "Never sent", sentLast30Days: 10, pendingCount: 1, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: true },
      { templateKey: "auth.password-reset", triggerLabel: "Auth Password Reset Email", category: "Auth", subject: "Reset your password", previewText: "", whenDescription: "On password reset request", status: "Active", marketingStatus: "Never sent", sentLast30Days: 6, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: true },
      { templateKey: "auth.verify-email-change", triggerLabel: "Auth Email Change Verification", category: "Auth", subject: "Confirm your new email", previewText: "", whenDescription: "On email change request", status: "Active", marketingStatus: "Never sent", sentLast30Days: 2, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: true },
      { templateKey: "payment.purchase.confirmation", triggerLabel: "Payment Purchase Confirmation", category: "Payment", subject: "Payment purchase confirmation", previewText: "", whenDescription: "Immediately on payment success", status: "Active", marketingStatus: "Never sent", sentLast30Days: 2, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: true },
      { templateKey: "store.purchase.confirmation", triggerLabel: "Store Purchase Confirmation", category: "Store", subject: "Store purchase confirmation", previewText: "", whenDescription: "Immediately on checkout success", status: "Active", marketingStatus: "Never sent", sentLast30Days: 2, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: true },
      { templateKey: "gift-card.issuance", triggerLabel: "Gift Card Issuance", category: "Gift card", subject: "Your gift card is ready", previewText: "", whenDescription: "Immediately after gift card purchase", status: "Active", marketingStatus: "Never sent", sentLast30Days: 2, pendingCount: 0, deadLetterCount: 0, openRate: null, clickRate: null, unsubscribeRate: null, exists: true },
    ]);
    render(await AdminAutomationsPage());

    expect(screen.getByRole("heading", { name: "Automations" })).toBeInTheDocument();
    expect(screen.getByText("Manage the email sent for each trigger event. One template per trigger.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Trigger" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Subject" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "When" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Sent - 30D" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Auth Verification Email")).toBeInTheDocument();
    expect(screen.getByText("Gift Card Issuance")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /View|Configure/ }).length).toBe(16);
  });

  it("renders online learning data from shared service", async () => {
    vi.mocked(getAdminOnlineLearningData).mockResolvedValue({
      programs: [
        {
          id: "lp1",
          courseType: "Yoga",
          mainTitle: "Yoga Program",
          title: "Yoga Basics",
          updatedAt: new Date().toISOString(),
        },
      ],
      videos: [
        {
          id: "lv1",
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
    expect(screen.queryByRole("columnheader", { name: "Legacy ID" })).not.toBeInTheDocument();
    expect(screen.getByText("Yoga Program")).toBeInTheDocument();
    expect(screen.getByText("Core Burn")).toBeInTheDocument();
  });

  it("renders online learning empty state", async () => {
    vi.mocked(getAdminOnlineLearningData).mockResolvedValue({ programs: [], videos: [] });

    render(await AdminOnlineLearningPage());

    expect(screen.getByText("No learning programs found.")).toBeInTheDocument();
    expect(screen.getByText("No learning videos found.")).toBeInTheDocument();
    expect(screen.queryByText("Unable to load online learning right now.")).not.toBeInTheDocument();
  });

  it("renders online learning error state", async () => {
    vi.mocked(getAdminOnlineLearningData).mockRejectedValue(new Error("DB error"));

    render(await AdminOnlineLearningPage());

    expect(screen.getByText("Unable to load online learning right now.")).toBeInTheDocument();
  });
});













































