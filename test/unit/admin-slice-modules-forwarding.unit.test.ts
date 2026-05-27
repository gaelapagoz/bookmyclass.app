import { describe, expect, it } from "vitest";

import {
  type AdminRecurringSessionScheduleInput as AdminRecurringSessionScheduleInputCore,
  type AdminSessionClientOption as AdminSessionClientOptionCore,
  type AdminSessionDetail as AdminSessionDetailCore,
  type AdminSessionItem as AdminSessionItemCore,
  createAdminRecurringSessions,
  createAdminSession,
  getAdminSessionById,
  getAdminSessionOptions,
  getAdminSessionsData,
  updateAdminSession,
} from "@/lib/admin/admin-session-core-service";
import {
  type AdminBookingItem as AdminBookingItemCore,
  type AdminBookingStatusFilter as AdminBookingStatusFilterCore,
  type AdminBookingsPageData as AdminBookingsPageDataCore,
  addSessionAttendeeByManager,
  getAdminBookingsData,
  getBookings,
  removeSessionAttendeeByManager,
} from "@/lib/admin/admin-booking-core-service";
import {
  type AdminClientActivityData as AdminClientActivityDataCore,
  type AdminClientStats as AdminClientStatsCore,
  type AdminMarketingSegmentOption as AdminMarketingSegmentOptionCore,
  type AdminUserDetail as AdminUserDetailCore,
  type AdminUserItem as AdminUserItemCore,
  type AdminUsersGroupedPageData as AdminUsersGroupedPageDataCore,
  type AdminUsersRolePageData as AdminUsersRolePageDataCore,
  adjustAdminClientCredits,
  bulkAddClientMarketingSegments,
  bulkRemoveClientMarketingSegments,
  bulkSetClientMarketingSubscriptionStatus,
  cancelAdminClientMembership,
  createAdminUser,
  getAdminAdminsPageData,
  getAdminClientActivityData,
  getAdminClientStats,
  getAdminClientsPageData,
  getAdminTeachersPageData,
  getAdminUserById,
  getAdminUsersData,
  getAdminUsersGroupedPageData,
  listAdminMarketingSegmentOptions,
  updateAdminTeacherImage,
  updateAdminUser,
} from "@/lib/admin/admin-user-core-service";
import {
  getAdminDashboardInsights as getAdminDashboardInsightsCore,
  getDashboardTrendData as getDashboardTrendDataCore,
  getOperationalMetricCards as getOperationalMetricCardsCore,
} from "@/lib/admin/admin-analytics-service";

import * as sessionSlice from "@/lib/admin/admin-session-service";
import * as bookingSlice from "@/lib/admin/admin-booking-service";
import * as userSlice from "@/lib/admin/admin-user-service";
import * as analyticsSlice from "@/lib/admin/admin-analytics-service";
import type {
  AdminRecurringSessionScheduleInput,
  AdminSessionClientOption,
  AdminSessionDetail,
  AdminSessionItem,
} from "@/lib/admin/admin-session-service";
import type {
  AdminBookingItem,
  AdminBookingStatusFilter,
  AdminBookingsPageData,
} from "@/lib/admin/admin-booking-service";
import type {
  AdminClientActivityData,
  AdminClientStats,
  AdminMarketingSegmentOption,
  AdminUserDetail,
  AdminUserItem,
  AdminUsersGroupedPageData,
  AdminUsersRolePageData,
} from "@/lib/admin/admin-user-service";

describe("admin session slice module forwarding", () => {
  it("forwards session exports to admin-session-core-service", () => {
    expect(sessionSlice.getAdminSessionsData).toBe(getAdminSessionsData);
    expect(sessionSlice.getAdminSessionById).toBe(getAdminSessionById);
    expect(sessionSlice.getAdminSessionOptions).toBe(getAdminSessionOptions);
    expect(sessionSlice.createAdminSession).toBe(createAdminSession);
    expect(sessionSlice.createAdminRecurringSessions).toBe(createAdminRecurringSessions);
    expect(sessionSlice.updateAdminSession).toBe(updateAdminSession);
  });
});

describe("admin booking slice module forwarding", () => {
  it("forwards booking exports to admin-booking-core-service", () => {
    expect(bookingSlice.getBookings).toBe(getBookings);
    expect(bookingSlice.getAdminBookingsData).toBe(getAdminBookingsData);
    expect(bookingSlice.addSessionAttendeeByManager).toBe(addSessionAttendeeByManager);
    expect(bookingSlice.removeSessionAttendeeByManager).toBe(removeSessionAttendeeByManager);
  });
});

describe("admin user slice module forwarding", () => {
  it("forwards user exports to admin-user-core-service", () => {
    expect(userSlice.getAdminUsersGroupedPageData).toBe(getAdminUsersGroupedPageData);
    expect(userSlice.getAdminAdminsPageData).toBe(getAdminAdminsPageData);
    expect(userSlice.getAdminTeachersPageData).toBe(getAdminTeachersPageData);
    expect(userSlice.getAdminClientsPageData).toBe(getAdminClientsPageData);
    expect(userSlice.getAdminClientStats).toBe(getAdminClientStats);
    expect(userSlice.getAdminUsersData).toBe(getAdminUsersData);
    expect(userSlice.getAdminUserById).toBe(getAdminUserById);
    expect(userSlice.getAdminClientActivityData).toBe(getAdminClientActivityData);
    expect(userSlice.adjustAdminClientCredits).toBe(adjustAdminClientCredits);
    expect(userSlice.cancelAdminClientMembership).toBe(cancelAdminClientMembership);
    expect(userSlice.createAdminUser).toBe(createAdminUser);
    expect(userSlice.updateAdminUser).toBe(updateAdminUser);
    expect(userSlice.listAdminMarketingSegmentOptions).toBe(listAdminMarketingSegmentOptions);
    expect(userSlice.bulkSetClientMarketingSubscriptionStatus).toBe(
      bulkSetClientMarketingSubscriptionStatus,
    );
    expect(userSlice.bulkAddClientMarketingSegments).toBe(bulkAddClientMarketingSegments);
    expect(userSlice.bulkRemoveClientMarketingSegments).toBe(bulkRemoveClientMarketingSegments);
    expect(userSlice.updateAdminTeacherImage).toBe(updateAdminTeacherImage);
  });
});

describe("admin analytics slice module forwarding", () => {
  it("exposes analytics APIs from admin-analytics-service", () => {
    expect(analyticsSlice.getAdminDashboardInsights).toBe(getAdminDashboardInsightsCore);
    expect(analyticsSlice.getOperationalMetricCards).toBe(getOperationalMetricCardsCore);
    expect(analyticsSlice.getDashboardTrendData).toBe(getDashboardTrendDataCore);
  });
});

describe("slice type ownership exports", () => {
  it("keeps wrapper types aligned with owning core modules", () => {
    const sessionItem: AdminSessionItem = {} as AdminSessionItemCore;
    const sessionDetail: AdminSessionDetail = {} as AdminSessionDetailCore;
    const sessionOption: AdminSessionClientOption = {} as AdminSessionClientOptionCore;
    const recurringInput: AdminRecurringSessionScheduleInput = {} as AdminRecurringSessionScheduleInputCore;
    const bookingItem: AdminBookingItem = {} as AdminBookingItemCore;
    const bookingPage: AdminBookingsPageData = {} as AdminBookingsPageDataCore;
    const bookingFilter: AdminBookingStatusFilter = {} as AdminBookingStatusFilterCore;
    const userItem: AdminUserItem = {} as AdminUserItemCore;
    const usersPage: AdminUsersRolePageData = {} as AdminUsersRolePageDataCore;
    const usersGrouped: AdminUsersGroupedPageData = {} as AdminUsersGroupedPageDataCore;
    const userDetail: AdminUserDetail = {} as AdminUserDetailCore;
    const clientActivity: AdminClientActivityData = {} as AdminClientActivityDataCore;
    const clientStats: AdminClientStats = {} as AdminClientStatsCore;
    const segmentOption: AdminMarketingSegmentOption = {} as AdminMarketingSegmentOptionCore;

    expect(sessionItem).toBeDefined();
    expect(sessionDetail).toBeDefined();
    expect(sessionOption).toBeDefined();
    expect(recurringInput).toBeDefined();
    expect(bookingItem).toBeDefined();
    expect(bookingPage).toBeDefined();
    expect(bookingFilter).toBeDefined();
    expect(userItem).toBeDefined();
    expect(usersPage).toBeDefined();
    expect(usersGrouped).toBeDefined();
    expect(userDetail).toBeDefined();
    expect(clientActivity).toBeDefined();
    expect(clientStats).toBeDefined();
    expect(segmentOption).toBeDefined();
  });
});

