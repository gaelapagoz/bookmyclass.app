import {
  AttendanceSource,
  AttendanceStatus,
  BillingInterval,
  BookingIntent,
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  MarketingSubscriptionStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  Weekday,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { generatePlanSlug } from "@/lib/admin/plan-slug";
import { ensureEntitlementRuleForProduct } from "@/lib/admin/plan-entitlement-rules";
import { provisionPlanOnStripe, resolveStripeProductIdFromPrice } from "@/lib/admin/plan-provisioning";
import {
  applyTrustedAdminEmailChange,
  createUserFromTrustedFlow,
} from "@/lib/auth/user-identity-service";
import { normalizeBookingCancellationWindowHours } from "@/lib/booking/cancellation-policy";
import { assertLearningImagePath } from "@/lib/learning/image-paths";
import { sendWaitlistPromotionNotification } from "@/lib/public-booking/waitlist-notification-service";
import { promoteWaitlistAfterCancellationWithinTx } from "@/lib/public-booking/waitlist-service";

export type AdminDashboardData = {
  upcomingSessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    bookedSpots: number;
    capacity: number;
  }>;
};

export type AdminPeriod = "last7Days" | "last30Days" | "last90Days";

export type AdminMetricKey =
  | "siteSessions"
  | "totalSales"
  | "totalOrders"
  | "bookings"
  | "cancellations";

export type AdminMetricCard = {
  key: AdminMetricKey;
  label: string;
  total: number;
  previousTotal: number;
  deltaPercentage: number | null;
  currentDailyValue: number;
  previousDailyValue: number;
  trendDirection: "up" | "down" | "flat";
  format: "number" | "currency";
};

export type DashboardMetricKey =
  | "sessions"
  | "sales"
  | "orders"
  | "bookings"
  | "cancellations";

export type DashboardTrendPoint = {
  date: string;
  sessions: number;
  sales: number;
  orders: number;
  bookings: number;
  cancellations: number;
};

export type TopClassSessionItem = {
  classTemplateId: string;
  classTitle: string;
  teacherName: string | null;
  bookedCount: number;
  sessionCount: number;
  averageCapacity: number;
};

export type TopClientItem = {
  clientId: string;
  clientName: string;
  bookedCount: number;
};

export type AtRiskClientItem = {
  clientId: string;
  clientName: string;
  lastBookingAt: string;
};

export type StaffPerformanceItem = {
  staffId: string;
  staffName: string;
  totalBookedPeople: number;
  classesDone: number;
  occupancyRatePercentage: number;
};

export type AdminDashboardInsights = {
  topClassSessions: TopClassSessionItem[];
  topClients: TopClientItem[];
  atRiskClients: AtRiskClientItem[];
  staffPerformance: StaffPerformanceItem[];
};

export type AdminSiteWeeklyScheduleEntry = {
  id: string;
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  serviceId: string | null;
  label: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminSiteScheduleServiceOption = {
  id: string;
  name: string;
};

export async function resolveAdminActorUser(input: { actorUserId: string }) {
  const actor = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  return actor;
}

export type AdminClassItem = {
  id: string;
  name: string;
  categoryName: string;
  defaultTeacherName: string | null;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
};

export type AdminClassScheduleConfig = {
  defaultTeacherId: string;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  date: string | null;
  weekdays: Weekday[];
  endDate: string | null;
};

export type AdminSessionItem = {
  id: string;
  title: string;
  className: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  status: StudioSessionStatus;
  isPublished: boolean;
  location: string | null;
};

export type AdminSessionAttendeeItem = {
  bookingId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  bookedAt: string;
  status: BookingStatus;
  selectedEntitlementId: string | null;
  attendanceStatus: AttendanceStatus | null;
  attendanceSource: AttendanceSource | null;
  checkedInAt: string | null;
};

export type AdminSessionDetail = {
  id: string;
  classTemplateId: string;
  teacherId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: StudioSessionStatus;
  isPublished: boolean;
  attendees: AdminSessionAttendeeItem[];
};

export type AdminSessionClientOption = {
  id: string;
  name: string;
  email: string;
  availableCredits: number;
  hasAvailableCredits: boolean;
};

export type AdminPlanItem = {
  id: string;
  name: string;
  productType: ProductType;
  isActive: boolean;
  sortOrder: number;
  currentPriceAmountMinor: number | null;
  currentPriceCurrencyCode: string | null;
  currentPriceType: PriceType | null;
  currentBillingInterval: BillingInterval | null;
  currentBillingIntervalCount: number | null;
  isCheckoutReady: boolean;
};

export type AdminBookingItem = {
  id: string;
  status: BookingStatus;
  paymentSelection: string | null;
  bookedAt: string;
  customerName: string;
  customerEmail: string;
  sessionTitle: string;
  startsAt: string;
};

export type AdminBookingsPageData = {
  data: AdminBookingItem[];
  totalPages: number;
};

export type AdminUserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
  marketingSegmentNames: string[];
};

export type AdminUsersRolePageData = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: AdminUserItem[];
};

export type AdminClientStats = {
  totalClients: number;
  neverSubscribedClients: number;
  subscribedClients: number;
  unsubscribedClients: number;
  totalSubscriptions: number;
};

export type AdminUsersGroupedPageData = {
  query: string;
  masterAdmins: AdminUsersRolePageData;
  admins: AdminUsersRolePageData;
  teachers: AdminUsersRolePageData;
  clients: AdminUsersRolePageData;
};

export type AdminMarketingSegmentOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export type AdminUserDetail = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  isActive: boolean;
  image: string;
  phone: string;
  notes: string;
  bio: string;
  specialties: string[];
  certifications: string[];
  hireDate: string | null;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
  marketingSegmentIds: string[];
};

export type AdminClientActivityData = {
  plansBought: Array<{
    orderId: string;
    productName: string;
    priceName: string;
    amountMinor: number;
    currencyCode: string;
    purchasedAt: string;
  }>;
  classesBooked: number;
  classesCancelled: number;
  outstandingMemberships: Array<{
    id: string;
    productName: string;
    status: SubscriptionStatus;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  }>;
  creditEntitlements: Array<{
    entitlementId: string;
    productName: string;
    status: ClientEntitlementStatus;
    expiresAt: string | null;
    remainingCredits: number;
  }>;
  creditsRemaining: number;
  nextCreditExpiration: string | null;
  eligibleCreditProducts: Array<{
    id: string;
    name: string;
  }>;
};

export type AdminSubscriptionItem = {
  id: string;
  clientName: string;
  clientEmail: string;
  productName: string;
  priceName: string;
  status: SubscriptionStatus;
  startsAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  endedAt: string | null;
  provider: PaymentProvider;
};

export type AdminOrderDateFilter = "all" | "last7Days" | "last30Days" | "last90Days";
export type AdminBookingStatusFilter =
  | "all"
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "noShow";
export type AdminSubscriptionStatusFilter =
  | "all"
  | "pending"
  | "active"
  | "cancelled"
  | "expired"
  | "pastDue";

export type AdminOrdersPageItem = {
  id: string;
  orderId: string;
  purchasedAt: string;
  clientName: string;
  clientEmail: string;
  productName: string;
  priceName: string;
  quantity: number;
  lineTotalAmountMinor: number;
  currencyCode: string;
};

export type AdminOrdersPageData = {
  filter: AdminOrderDateFilter;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: AdminOrdersPageItem[];
};

export type AdminSubscriptionsPageData = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: AdminSubscriptionItem[];
};

export type AdminLearningProgramItem = {
  id: string;
  courseType: string;
  mainTitle: string;
  title: string;
  updatedAt: string;
};

export type AdminLearningVideoItem = {
  id: string;
  title: string;
  category: string;
  categoryType: string | null;
  categoryLevel: string | null;
  priority: number;
  updatedAt: string;
};

export type AdminRecurringSessionScheduleInput = {
  startsOn: Date;
  startTime: string;
  endTime: string;
  repeatEveryWeeks: number;
  weekdays: Weekday[];
  endMode: "never" | "on_date" | "after_occurrences";
  endDate?: Date | null;
  occurrences?: number;
};

function toNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { firstName: "User", lastName: "Account" };
  }

  const parts = normalized.split(" ");
  const firstName = parts.shift() ?? "User";
  const lastName = parts.join(" ") || "Account";
  return { firstName, lastName };
}

const WEEKDAY_TO_INDEX: Record<Weekday, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

function startOfWeekMonday(input: Date): Date {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  const jsDay = date.getDay();
  const diffToMonday = (jsDay + 6) % 7;
  date.setDate(date.getDate() - diffToMonday);
  return date;
}

function addDays(input: Date, amount: number): Date {
  const date = new Date(input);
  date.setDate(date.getDate() + amount);
  return date;
}

function parseTimeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

function withTime(input: Date, time: string): Date {
  const [hour, minute] = time.split(":").map((part) => Number.parseInt(part, 10));
  const date = new Date(input);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function toEntitlementScopeFromCategorySlug(categorySlug: string): EntitlementScope {
  if (categorySlug.includes("private")) {
    return EntitlementScope.PRIVATE_CLASSES;
  }

  if (categorySlug.includes("workshop")) {
    return EntitlementScope.WORKSHOPS;
  }

  return EntitlementScope.COLLECTIVE_CLASSES;
}

function buildRecurringOccurrences(input: AdminRecurringSessionScheduleInput): Array<{
  weekday: Weekday;
  startsAt: Date;
  endsAt: Date;
}> {
  const startMinutes = parseTimeToMinutes(input.startTime);
  const endMinutes = parseTimeToMinutes(input.endTime);
  const durationMinutes = endMinutes - startMinutes;
  const rangeStart = new Date(input.startsOn);
  rangeStart.setHours(0, 0, 0, 0);

  const targetCount = input.endMode === "after_occurrences" ? input.occurrences ?? 0 : 0;
  const endDate =
    input.endMode === "on_date" && input.endDate
      ? (() => {
          const parsed = new Date(input.endDate);
          parsed.setHours(23, 59, 59, 999);
          return parsed;
        })()
      : null;

  const maxOccurrences = input.endMode === "after_occurrences" ? targetCount : 260;
  const weekAnchor = startOfWeekMonday(rangeStart);
  const weekdayOrder = [...input.weekdays].sort(
    (a, b) => WEEKDAY_TO_INDEX[a] - WEEKDAY_TO_INDEX[b],
  );

  const results: Array<{ weekday: Weekday; startsAt: Date; endsAt: Date }> = [];
  for (
    let cycleStart = new Date(weekAnchor);
    results.length < maxOccurrences;
    cycleStart = addDays(cycleStart, input.repeatEveryWeeks * 7)
  ) {
    if (endDate && cycleStart > endDate) {
      break;
    }

    for (const weekday of weekdayOrder) {
      const dayOffset = (WEEKDAY_TO_INDEX[weekday] + 6) % 7;
      const occurrenceDay = addDays(cycleStart, dayOffset);
      if (occurrenceDay < rangeStart) {
        continue;
      }
      if (endDate && occurrenceDay > endDate) {
        continue;
      }

      const startsAt = withTime(occurrenceDay, input.startTime);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
      results.push({ weekday, startsAt, endsAt });

      if (results.length >= maxOccurrences) {
        break;
      }
    }
  }

  return results;
}

type DateRange = { start: Date; end: Date };

const VALID_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
];

const UPCOMING_BOOKED_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

type AdminPeriodRanges = {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
  todayStart: Date;
  yesterdayStart: Date;
};

export function getRollingPeriodRange(period: AdminPeriod, now: Date): AdminPeriodRanges {
  const durationDays =
    period === "last7Days"
      ? 7
      : period === "last30Days"
        ? 30
        : 90;

  const currentEnd = new Date(now);
  const currentStart = addDays(currentEnd, -durationDays);
  const previousEnd = new Date(currentStart);
  const previousStart = addDays(previousEnd, -durationDays);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = addDays(todayStart, -1);

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    todayStart,
    yesterdayStart,
  };
}

function getAdminOrderFilterStart(filter: AdminOrderDateFilter, now: Date): Date | null {
  if (filter === "last7Days") {
    return addDays(now, -7);
  }
  if (filter === "last30Days") {
    return addDays(now, -30);
  }
  if (filter === "last90Days") {
    return addDays(now, -90);
  }
  return null;
}

function getAdminBookingStatus(filter: AdminBookingStatusFilter): BookingStatus | null {
  if (filter === "pending") {
    return BookingStatus.PENDING;
  }
  if (filter === "confirmed") {
    return BookingStatus.CONFIRMED;
  }
  if (filter === "cancelled") {
    return BookingStatus.CANCELLED;
  }
  if (filter === "completed") {
    return BookingStatus.COMPLETED;
  }
  if (filter === "noShow") {
    return BookingStatus.NO_SHOW;
  }
  return null;
}

function getAdminSubscriptionStatus(filter: AdminSubscriptionStatusFilter): SubscriptionStatus | null {
  if (filter === "pending") {
    return SubscriptionStatus.PENDING;
  }
  if (filter === "active") {
    return SubscriptionStatus.ACTIVE;
  }
  if (filter === "cancelled") {
    return SubscriptionStatus.CANCELLED;
  }
  if (filter === "expired") {
    return SubscriptionStatus.EXPIRED;
  }
  if (filter === "pastDue") {
    return SubscriptionStatus.PAST_DUE;
  }
  return null;
}

function periodDayCount(period: AdminPeriod): number {
  if (period === "last7Days") {
    return 7;
  }
  if (period === "last30Days") {
    return 30;
  }
  return 90;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildTrendBase(now: Date, totalDays: number): Map<string, DashboardTrendPoint> {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const start = addDays(todayStart, -(totalDays - 1));
  const buckets = new Map<string, DashboardTrendPoint>();

  for (let dayOffset = 0; dayOffset < totalDays; dayOffset += 1) {
    const date = addDays(start, dayOffset);
    const key = toDayKey(date);
    buckets.set(key, {
      date: key,
      sessions: 0,
      sales: 0,
      orders: 0,
      bookings: 0,
      cancellations: 0,
    });
  }

  return buckets;
}

type MetricDefinition = {
  key: AdminMetricKey;
  label: string;
  format: AdminMetricCard["format"];
  getValue: (range: DateRange) => Promise<number>;
};

function getMetricDelta(total: number, previousTotal: number) {
  if (previousTotal === 0 && total === 0) {
    return {
      deltaPercentage: 0,
      trendDirection: "flat" as const,
    };
  }

  if (previousTotal === 0 && total > 0) {
    return {
      deltaPercentage: null,
      trendDirection: "up" as const,
    };
  }

  const rawDelta = ((total - previousTotal) / previousTotal) * 100;
  const deltaPercentage = Number(rawDelta.toFixed(1));
  if (deltaPercentage > 0) {
    return { deltaPercentage, trendDirection: "up" as const };
  }
  if (deltaPercentage < 0) {
    return { deltaPercentage, trendDirection: "down" as const };
  }

  return { deltaPercentage, trendDirection: "flat" as const };
}

export async function getOperationalMetricCards(period: AdminPeriod): Promise<AdminMetricCard[]> {
  const now = new Date();
  const ranges = getRollingPeriodRange(period, now);
  const todayEnd = addDays(ranges.todayStart, 1);

  const metricDefinitions: MetricDefinition[] = [
    {
      key: "siteSessions",
      label: "Site Sessions",
      format: "number",
      getValue: (range) =>
        prisma.session.count({
          where: {
            createdAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        }),
    },
    {
      key: "totalSales",
      label: "Total Sales",
      format: "currency",
      getValue: async (range) => {
        const result = await prisma.payment.aggregate({
          _sum: {
            amountMinor: true,
          },
          where: {
            status: PaymentStatus.SUCCEEDED,
            createdAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        });
        return result._sum.amountMinor ?? 0;
      },
    },
    {
      key: "totalOrders",
      label: "Total Orders",
      format: "number",
      getValue: (range) =>
        prisma.order.count({
          where: {
            status: OrderStatus.PAID,
            placedAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        }),
    },
    {
      key: "bookings",
      label: "Total Bookings",
      format: "number",
      getValue: (range) =>
        prisma.booking.count({
          where: {
            status: {
              in: VALID_BOOKING_STATUSES,
            },
            bookedAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        }),
    },
    {
      key: "cancellations",
      label: "Total Cancellations",
      format: "number",
      getValue: (range) =>
        prisma.booking.count({
          where: {
            status: BookingStatus.CANCELLED,
            cancelledAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        }),
    },
  ];

  const cards = await Promise.all(
    metricDefinitions.map(async (metric): Promise<AdminMetricCard> => {
      const [total, previousTotal, currentDailyValue, previousDailyValue] = await Promise.all([
        metric.getValue({ start: ranges.currentStart, end: ranges.currentEnd }),
        metric.getValue({ start: ranges.previousStart, end: ranges.previousEnd }),
        metric.getValue({ start: ranges.todayStart, end: todayEnd }),
        metric.getValue({ start: ranges.yesterdayStart, end: ranges.todayStart }),
      ]);
      const delta = getMetricDelta(total, previousTotal);

      return {
        key: metric.key,
        label: metric.label,
        total,
        previousTotal,
        deltaPercentage: delta.deltaPercentage,
        currentDailyValue,
        previousDailyValue,
        trendDirection: delta.trendDirection,
        format: metric.format,
      };
    }),
  );

  return cards;
}

export async function getDashboardTrendData(period: AdminPeriod): Promise<DashboardTrendPoint[]> {
  const now = new Date();
  const days = periodDayCount(period);
  const totalDays = 100;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const start = addDays(todayStart, -(totalDays - 1));
  const end = addDays(todayStart, 1);

  const [sessions, sales, orders, bookings, cancellations] = await Promise.all([
    prisma.session.findMany({
      where: {
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      select: { createdAt: true },
    }),
    prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCEEDED,
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      select: {
        createdAt: true,
        amountMinor: true,
      },
    }),
    prisma.order.findMany({
      where: {
        status: OrderStatus.PAID,
        placedAt: {
          gte: start,
          lt: end,
        },
      },
      select: { placedAt: true },
    }),
    prisma.booking.findMany({
      where: {
        status: {
          in: VALID_BOOKING_STATUSES,
        },
        bookedAt: {
          gte: start,
          lt: end,
        },
      },
      select: { bookedAt: true },
    }),
    prisma.booking.findMany({
      where: {
        status: BookingStatus.CANCELLED,
        cancelledAt: {
          gte: start,
          lt: end,
        },
      },
      select: { cancelledAt: true },
    }),
  ]);

  const buckets = buildTrendBase(now, totalDays);

  for (const row of sessions) {
    const bucket = buckets.get(toDayKey(row.createdAt));
    if (bucket) {
      bucket.sessions += 1;
    }
  }

  for (const row of sales) {
    const bucket = buckets.get(toDayKey(row.createdAt));
    if (bucket) {
      bucket.sales += row.amountMinor;
    }
  }

  for (const row of orders) {
    const bucket = buckets.get(toDayKey(row.placedAt));
    if (bucket) {
      bucket.orders += 1;
    }
  }

  for (const row of bookings) {
    const bucket = buckets.get(toDayKey(row.bookedAt));
    if (bucket) {
      bucket.bookings += 1;
    }
  }

  for (const row of cancellations) {
    if (!row.cancelledAt) {
      continue;
    }
    const bucket = buckets.get(toDayKey(row.cancelledAt));
    if (bucket) {
      bucket.cancellations += 1;
    }
  }

  const fullDataset = [...buckets.values()];
  return fullDataset.slice(-days);
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const now = new Date();
  const upcomingSessions = await prisma.studioSession.findMany({
    where: {
      startsAt: { gt: now },
      status: StudioSessionStatus.SCHEDULED,
    },
    orderBy: [{ startsAt: "asc" }],
    take: 20,
    select: {
      id: true,
      title: true,
      startsAt: true,
      capacity: true,
      bookings: {
        where: {
          status: {
            in: UPCOMING_BOOKED_STATUSES,
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  return {
    upcomingSessions: upcomingSessions.map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt.toISOString(),
      bookedSpots: session.bookings.length,
      capacity: session.capacity,
    })),
  };
}

export async function getAdminDashboardInsights(period: AdminPeriod): Promise<AdminDashboardInsights> {
  const periodRange = getRollingPeriodRange(period, new Date());

  const [bookingsInWindow, bookingsBeforeWindow, staffSessionsInWindow] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: VALID_BOOKING_STATUSES },
        bookedAt: {
          gte: periodRange.currentStart,
          lt: periodRange.currentEnd,
        },
      },
      select: {
        id: true,
        clientId: true,
        bookedAt: true,
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        studioSession: {
          select: {
            id: true,
            classTemplateId: true,
            title: true,
            capacity: true,
            teacher: {
              select: {
                name: true,
              },
            },
            classTemplate: {
              select: {
                title: true,
                defaultTeacher: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: VALID_BOOKING_STATUSES },
        bookedAt: {
          lt: periodRange.currentStart,
        },
      },
      select: {
        clientId: true,
        bookedAt: true,
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.studioSession.findMany({
      where: {
        startsAt: {
          gte: periodRange.currentStart,
          lt: periodRange.currentEnd,
        },
        status: {
          in: [StudioSessionStatus.SCHEDULED, StudioSessionStatus.COMPLETED],
        },
      },
      select: {
        id: true,
        capacity: true,
        teacherId: true,
        teacher: {
          select: {
            name: true,
          },
        },
        bookings: {
          where: {
            status: { in: VALID_BOOKING_STATUSES },
          },
          select: {
            id: true,
          },
        },
      },
    }),
  ]);

  const classAggregateMap = new Map<
    string,
    {
      classTemplateId: string;
      classTitle: string;
      teacherName: string | null;
      bookedCount: number;
      sessionIds: Set<string>;
      capacitySum: number;
    }
  >();

  const clientAggregateMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      bookedCount: number;
    }
  >();

  for (const booking of bookingsInWindow) {
    const classTemplateId = booking.studioSession.classTemplateId;
    const classTitle = booking.studioSession.classTemplate.title || booking.studioSession.title;
    const teacherName =
      booking.studioSession.teacher.name ||
      booking.studioSession.classTemplate.defaultTeacher.name ||
      null;

    const existingClass = classAggregateMap.get(classTemplateId);
    if (existingClass) {
      existingClass.bookedCount += 1;
      if (!existingClass.sessionIds.has(booking.studioSession.id)) {
        existingClass.sessionIds.add(booking.studioSession.id);
        existingClass.capacitySum += booking.studioSession.capacity;
      }
    } else {
      classAggregateMap.set(classTemplateId, {
        classTemplateId,
        classTitle,
        teacherName,
        bookedCount: 1,
        sessionIds: new Set([booking.studioSession.id]),
        capacitySum: booking.studioSession.capacity,
      });
    }

    if (booking.clientId && booking.client) {
      const existingClient = clientAggregateMap.get(booking.clientId);
      if (existingClient) {
        existingClient.bookedCount += 1;
      } else {
        clientAggregateMap.set(booking.clientId, {
          clientId: booking.clientId,
          clientName: booking.client.name,
          bookedCount: 1,
        });
      }
    }
  }

  const topClassSessions = [...classAggregateMap.values()]
    .map((item): TopClassSessionItem => ({
      classTemplateId: item.classTemplateId,
      classTitle: item.classTitle,
      teacherName: item.teacherName,
      bookedCount: item.bookedCount,
      sessionCount: item.sessionIds.size,
      averageCapacity:
        item.sessionIds.size > 0 ? Math.round(item.capacitySum / item.sessionIds.size) : 0,
    }))
    .sort((a, b) => {
      if (b.bookedCount !== a.bookedCount) {
        return b.bookedCount - a.bookedCount;
      }
      return a.classTitle.localeCompare(b.classTitle);
    })
    .slice(0, 5);

  const topClients = [...clientAggregateMap.values()]
    .sort((a, b) => {
      if (b.bookedCount !== a.bookedCount) {
        return b.bookedCount - a.bookedCount;
      }
      return a.clientName.localeCompare(b.clientName);
    })
    .slice(0, 5);

  const currentlyActiveClientIds = new Set(topClients.map((entry) => entry.clientId));
  for (const clientId of clientAggregateMap.keys()) {
    currentlyActiveClientIds.add(clientId);
  }

  const historicalClientMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      lastBookingAt: Date;
    }
  >();
  for (const booking of bookingsBeforeWindow) {
    if (!booking.clientId || !booking.client) {
      continue;
    }
    const existing = historicalClientMap.get(booking.clientId);
    if (!existing || booking.bookedAt > existing.lastBookingAt) {
      historicalClientMap.set(booking.clientId, {
        clientId: booking.clientId,
        clientName: booking.client.name,
        lastBookingAt: booking.bookedAt,
      });
    }
  }

  const atRiskClients = [...historicalClientMap.values()]
    .filter((entry) => !currentlyActiveClientIds.has(entry.clientId))
    .sort((a, b) => b.lastBookingAt.getTime() - a.lastBookingAt.getTime())
    .slice(0, 5)
    .map((entry): AtRiskClientItem => ({
      clientId: entry.clientId,
      clientName: entry.clientName,
      lastBookingAt: entry.lastBookingAt.toISOString(),
    }));

  const staffPerformanceMap = new Map<
    string,
    {
      staffId: string;
      staffName: string;
      totalBookedPeople: number;
      classesDone: number;
      capacityTotal: number;
    }
  >();
  for (const session of staffSessionsInWindow) {
    const existing = staffPerformanceMap.get(session.teacherId);
    if (existing) {
      existing.classesDone += 1;
      existing.capacityTotal += session.capacity;
      existing.totalBookedPeople += session.bookings.length;
    } else {
      staffPerformanceMap.set(session.teacherId, {
        staffId: session.teacherId,
        staffName: session.teacher.name,
        totalBookedPeople: session.bookings.length,
        classesDone: 1,
        capacityTotal: session.capacity,
      });
    }
  }

  const staffPerformance = [...staffPerformanceMap.values()]
    .map((entry): StaffPerformanceItem => ({
      staffId: entry.staffId,
      staffName: entry.staffName,
      totalBookedPeople: entry.totalBookedPeople,
      classesDone: entry.classesDone,
      occupancyRatePercentage:
        entry.capacityTotal > 0
          ? Number(((entry.totalBookedPeople / entry.capacityTotal) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => {
      if (b.totalBookedPeople !== a.totalBookedPeople) {
        return b.totalBookedPeople - a.totalBookedPeople;
      }
      if (b.classesDone !== a.classesDone) {
        return b.classesDone - a.classesDone;
      }
      return a.staffName.localeCompare(b.staffName);
    });

  return {
    topClassSessions,
    topClients,
    atRiskClients,
    staffPerformance,
  };
}

export async function getAdminClassesData(): Promise<AdminClassItem[]> {
  const classes = await prisma.classType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
      templates: {
        orderBy: [{ createdAt: "asc" }],
        take: 1,
        select: {
          defaultTeacher: {
            select: {
              name: true,
            },
          },
        },
      },
      category: {
        select: {
          name: true,
        },
      },
    },
  });

  return classes.map((item) => ({
    id: item.id,
    name: item.name,
    categoryName: item.category.name,
    defaultTeacherName: item.templates[0]?.defaultTeacher?.name ?? null,
    defaultCapacity: item.defaultCapacity,
    isActive: item.isActive,
    isVisible: item.isVisible,
    sortOrder: item.sortOrder,
  }));
}

export async function getAdminClassById(id: string) {
  const classType = await prisma.classType.findUnique({
    where: { id },
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      imageUrl: true,
      description: true,
      defaultDurationMinutes: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
      templates: {
        orderBy: [{ createdAt: "asc" }],
        take: 1,
        select: {
          id: true,
          defaultTeacherId: true,
          defaultDurationMinutes: true,
          recurringRules: {
            where: { isActive: true },
            orderBy: [{ weekday: "asc" }],
            select: {
              weekday: true,
              startTime: true,
              startDate: true,
              endDate: true,
            },
          },
          studioSessions: {
            where: {
              status: StudioSessionStatus.SCHEDULED,
              startsAt: {
                gte: new Date(),
              },
            },
            orderBy: [{ startsAt: "asc" }],
            take: 1,
            select: {
              startsAt: true,
              endsAt: true,
            },
          },
        },
      },
    },
  });

  if (!classType) {
    return null;
  }

  const template = classType.templates[0] ?? null;
  const recurringRules = template?.recurringRules ?? [];
  const nextSession = template?.studioSessions[0] ?? null;
  const startTime = recurringRules[0]?.startTime ?? (nextSession ? formatTimeString(nextSession.startsAt) : "18:00");
  const defaultDuration =
    template?.defaultDurationMinutes ?? classType.defaultDurationMinutes;
  const endTime = addMinutesToTimeString(startTime, defaultDuration);
  const isRecurring = recurringRules.length > 0;
  const defaultDate = isRecurring
    ? recurringRules[0]?.startDate.toISOString().slice(0, 10) ?? null
    : nextSession?.startsAt.toISOString().slice(0, 10) ?? null;

  const schedule: AdminClassScheduleConfig = {
    defaultTeacherId: template?.defaultTeacherId ?? "",
    startTime,
    endTime,
    isRecurring,
    date: defaultDate,
    weekdays: [...new Set(recurringRules.map((rule) => rule.weekday))],
    endDate: recurringRules[0]?.endDate?.toISOString().slice(0, 10) ?? null,
  };

  return {
    id: classType.id,
    categoryId: classType.categoryId,
    name: classType.name,
    slug: classType.slug,
    imageUrl: classType.imageUrl,
    description: classType.description,
    defaultDurationMinutes: classType.defaultDurationMinutes,
    defaultCapacity: classType.defaultCapacity,
    isActive: classType.isActive,
    isVisible: classType.isVisible,
    sortOrder: classType.sortOrder,
    schedule,
  };
}

function formatTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function addMinutesToTimeString(time: string, amount: number): string {
  const [hour, minute] = time.split(":").map((item) => Number.parseInt(item, 10));
  const total = hour * 60 + minute + amount;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const endHour = Math.floor(normalized / 60);
  const endMinute = normalized % 60;
  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
}

function buildDateRangeOccurrences(input: {
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  weekdays: Weekday[];
}): Array<{ weekday: Weekday; startsAt: Date; endsAt: Date }> {
  const startDay = new Date(input.startDate);
  const endDay = new Date(input.endDate);
  startDay.setHours(0, 0, 0, 0);
  endDay.setHours(23, 59, 59, 999);

  const durationMinutes = validateTimeRange(input.startTime, input.endTime);
  const allowedWeekdays = new Set(input.weekdays);
  const indexToWeekday: Record<number, Weekday> = {
    0: Weekday.SUNDAY,
    1: Weekday.MONDAY,
    2: Weekday.TUESDAY,
    3: Weekday.WEDNESDAY,
    4: Weekday.THURSDAY,
    5: Weekday.FRIDAY,
    6: Weekday.SATURDAY,
  };

  const results: Array<{ weekday: Weekday; startsAt: Date; endsAt: Date }> = [];
  const cursor = new Date(startDay);

  while (cursor <= endDay) {
    const weekday = indexToWeekday[cursor.getDay()];
    if (allowedWeekdays.has(weekday)) {
      const startsAt = withTime(cursor, input.startTime);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
      results.push({ weekday, startsAt, endsAt });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return results;
}

export async function getAdminClassScheduleOptions() {
  return prisma.user.findMany({
    where: {
      role: {
        in: [Role.TEACHER, Role.ADMIN, Role.MASTER_ADMIN],
      },
      isActive: true,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });
}

export async function getClassCategoryOptions() {
  return prisma.classCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

async function buildUniqueClassSlug(name: string, excludeClassTypeId?: string): Promise<string> {
  const base = generatePlanSlug(name) || "service";
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.classType.findFirst({
      where: {
        slug: candidate,
        ...(excludeClassTypeId ? { id: { not: excludeClassTypeId } } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function createAdminClass(input: {
  categoryId: string;
  name: string;
  imageUrl?: string | null;
  description?: string;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
}) {
  const slug = await buildUniqueClassSlug(input.name);

  return prisma.classType.create({
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug,
      imageUrl: toNullable(input.imageUrl),
      description: toNullable(input.description),
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      isActive: input.isActive,
      isVisible: input.isVisible,
      sortOrder: input.sortOrder,
    },
  });
}

export async function updateAdminClass(
  id: string,
  input: {
    categoryId: string;
    name: string;
    imageUrl?: string | null;
    description?: string;
    defaultDurationMinutes: number;
    defaultCapacity: number;
    isActive: boolean;
    isVisible: boolean;
    sortOrder: number;
  },
) {
  const slug = await buildUniqueClassSlug(input.name, id);

  return prisma.classType.update({
    where: { id },
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug,
      imageUrl: toNullable(input.imageUrl),
      description: toNullable(input.description),
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      isActive: input.isActive,
      isVisible: input.isVisible,
      sortOrder: input.sortOrder,
    },
  });
}

function combineDateAndTime(dateValue: Date, timeValue: string): Date {
  const [hours, minutes] = timeValue.split(":").map((part) => Number.parseInt(part, 10));
  const date = new Date(dateValue);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function validateTimeRange(startTime: string, endTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes) || endMinutes <= startMinutes) {
    throw new Error("INVALID_SESSION_TIME_RANGE");
  }
  return endMinutes - startMinutes;
}

export async function upsertAdminClassScheduleConfig(input: {
  classTypeId: string;
  className: string;
  defaultCapacity: number;
  defaultDurationMinutes: number;
  defaultTeacherId: string;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  date?: Date | null;
  weekdays?: Weekday[];
  endDate?: Date | null;
}) {
  if (!input.defaultTeacherId) {
    throw new Error("TEACHER_REQUIRED");
  }

  const durationMinutes = validateTimeRange(input.startTime, input.endTime);
  const weekdays = [...new Set(input.weekdays ?? [])];
  const now = new Date();

  if (input.isRecurring && weekdays.length < 1) {
    throw new Error("INVALID_RECURRENCE_WEEKDAYS");
  }
  if (input.isRecurring && !input.date) {
    throw new Error("SCHEDULE_DATE_REQUIRED");
  }
  if (input.isRecurring && !input.endDate) {
    throw new Error("RECURRENCE_END_DATE_REQUIRED");
  }
  if (input.isRecurring && input.date && input.endDate && input.endDate < input.date) {
    throw new Error("INVALID_RECURRENCE_DATE_RANGE");
  }
  if (!input.isRecurring && !input.date) {
    throw new Error("SCHEDULE_DATE_REQUIRED");
  }

  await prisma.$transaction(async (tx) => {
    const existingTemplate = await tx.classTemplate.findFirst({
      where: { classTypeId: input.classTypeId },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, slug: true },
    });

    const template =
      existingTemplate
        ? await tx.classTemplate.update({
            where: { id: existingTemplate.id },
            data: {
              title: `${input.className} Schedule`,
              defaultTeacherId: input.defaultTeacherId,
              defaultCapacity: input.defaultCapacity,
              defaultDurationMinutes: input.defaultDurationMinutes,
              isActive: true,
              isPublished: true,
            },
            select: { id: true },
          })
        : await tx.classTemplate.create({
            data: {
              classTypeId: input.classTypeId,
              defaultTeacherId: input.defaultTeacherId,
              title: `${input.className} Schedule`,
              slug: `${input.classTypeId}-schedule-${Date.now()}`,
              defaultCapacity: input.defaultCapacity,
              defaultDurationMinutes: input.defaultDurationMinutes,
              isActive: true,
              isPublished: true,
            },
            select: { id: true },
          });

    await tx.studioSession.deleteMany({
      where: {
        classTemplateId: template.id,
        startsAt: { gte: now },
        bookings: { none: {} },
      },
    });

    await tx.recurringRule.updateMany({
      where: { classTemplateId: template.id },
      data: { isActive: false },
    });

    if (input.isRecurring) {
      const startsOn = input.date!;
      const occurrences = buildDateRangeOccurrences({
        startDate: startsOn,
        endDate: input.endDate!,
        startTime: input.startTime,
        endTime: input.endTime,
        weekdays,
      });
      if (occurrences.length < 1) {
        throw new Error("NO_RECURRENCE_OCCURRENCES");
      }
      const endDateForRule = input.endDate!;

      const ruleByWeekday = new Map<Weekday, string>();
      for (const weekday of weekdays) {
        const rule = await tx.recurringRule.upsert({
          where: {
            classTemplateId_weekday_startTime_startDate: {
              classTemplateId: template.id,
              weekday,
              startTime: input.startTime,
              startDate: startsOn,
            },
          },
          create: {
            classTemplateId: template.id,
            weekday,
            startTime: input.startTime,
            startDate: startsOn,
            endDate: endDateForRule,
            isActive: true,
          },
          update: {
            endDate: endDateForRule,
            isActive: true,
          },
          select: {
            id: true,
            weekday: true,
          },
        });
        ruleByWeekday.set(rule.weekday, rule.id);
      }

      if (occurrences.length > 0) {
        await tx.studioSession.createMany({
          data: occurrences.map((occurrence) => ({
            classTemplateId: template.id,
            recurringRuleId: ruleByWeekday.get(occurrence.weekday) ?? null,
            classTypeId: input.classTypeId,
            teacherId: input.defaultTeacherId,
            title: input.className,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            capacity: input.defaultCapacity,
            status: StudioSessionStatus.SCHEDULED,
            isPublished: true,
          })),
          skipDuplicates: true,
        });
      }
      return;
    }

    const startsAt = combineDateAndTime(input.date!, input.startTime);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
    await tx.studioSession.upsert({
      where: {
        classTemplateId_startsAt: {
          classTemplateId: template.id,
          startsAt,
        },
      },
      create: {
        classTemplateId: template.id,
        recurringRuleId: null,
        classTypeId: input.classTypeId,
        teacherId: input.defaultTeacherId,
        title: input.className,
        startsAt,
        endsAt,
        capacity: input.defaultCapacity,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
      update: {
        teacherId: input.defaultTeacherId,
        title: input.className,
        endsAt,
        capacity: input.defaultCapacity,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
    });
  });
}

export async function getAdminSessionsData(input?: {
  weekStart?: Date;
  weekEnd?: Date;
  teacherId?: string;
}): Promise<AdminSessionItem[]> {
  const sessions = await prisma.studioSession.findMany({
    where: {
      ...(input?.weekStart && input.weekEnd
        ? {
            startsAt: {
              gte: input.weekStart,
              lt: input.weekEnd,
            },
          }
        : {}),
      ...(input?.teacherId ? { teacherId: input.teacherId } : {}),
    },
    orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      location: true,
      capacity: true,
      status: true,
      isPublished: true,
      classType: {
        select: {
          name: true,
        },
      },
      teacher: {
        select: {
          name: true,
        },
      },
      bookings: {
        where: {
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
          },
        },
        select: {
          id: true,
        },
      },
    },
  });

  return sessions.map((item) => ({
    id: item.id,
    title: item.title,
    className: item.classType.name,
    teacherName: item.teacher.name,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    location: item.location,
    capacity: item.capacity,
    bookedCount: item.bookings.length,
    status: item.status,
    isPublished: item.isPublished,
  }));
}

export async function getAdminSessionById(id: string): Promise<AdminSessionDetail | null> {
  return prisma.studioSession.findUnique({
    where: { id },
    select: {
      id: true,
      classTemplateId: true,
      teacherId: true,
      title: true,
      description: true,
      location: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      isPublished: true,
      bookings: {
        where: {
          status: BookingStatus.CONFIRMED,
          clientId: {
            not: null,
          },
        },
        orderBy: [{ bookedAt: "asc" }],
        select: {
          id: true,
          clientId: true,
          bookedAt: true,
          status: true,
          selectedEntitlementId: true,
          client: {
            select: {
              name: true,
              email: true,
            },
          },
          attendanceRecord: {
            select: {
              id: true,
              status: true,
              source: true,
              markedAt: true,
            },
          },
        },
      },
    },
  }).then((session) => {
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      classTemplateId: session.classTemplateId,
      teacherId: session.teacherId,
      title: session.title,
      description: session.description,
      location: session.location,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      capacity: session.capacity,
      status: session.status,
      isPublished: session.isPublished,
      attendees: session.bookings.map((booking) => ({
        bookingId: booking.id,
        clientId: booking.clientId ?? "",
        clientName: booking.client?.name ?? "Unknown client",
        clientEmail: booking.client?.email ?? "",
        bookedAt: booking.bookedAt.toISOString(),
        status: booking.status,
        selectedEntitlementId: booking.selectedEntitlementId,
        attendanceStatus: booking.attendanceRecord?.status ?? null,
        attendanceSource: booking.attendanceRecord?.source ?? null,
        checkedInAt: booking.attendanceRecord?.markedAt?.toISOString() ?? null,
      })),
    };
  });
}

export async function getAdminSessionOptions(sessionId?: string): Promise<{
  templates: Array<{ id: string; title: string; classTypeId: string }>;
  teachers: Array<{ id: string; name: string }>;
  clients: AdminSessionClientOption[];
}> {
  const [templates, teachers, clients] = await prisma.$transaction([
    prisma.classTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ title: "asc" }],
      select: {
        id: true,
        title: true,
        classTypeId: true,
      },
    }),
    prisma.user.findMany({
      where: {
        role: {
          in: [Role.TEACHER, Role.ADMIN, Role.MASTER_ADMIN],
        },
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.user.findMany({
      where: {
        role: Role.CLIENT,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
      },
    }),
  ]);

  if (!sessionId) {
    return {
      templates,
      teachers,
      clients: clients.map((client) => ({
        ...client,
        availableCredits: 0,
        hasAvailableCredits: false,
      })),
    };
  }

  const sessionClassCategory = await prisma.studioSession.findUnique({
    where: { id: sessionId },
    select: {
      classType: {
        select: {
          category: {
            select: {
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!sessionClassCategory) {
    return {
      templates,
      teachers,
      clients: clients.map((client) => ({
        ...client,
        availableCredits: 0,
        hasAvailableCredits: false,
      })),
    };
  }

  const requiredScope = toEntitlementScopeFromCategorySlug(sessionClassCategory.classType.category.slug);
  const availableCreditsByClientId = await getClientAvailableCreditsByScope({
    clientIds: clients.map((client) => client.id),
    requiredScope,
  });

  return {
    templates,
    teachers,
    clients: clients.map((client) => {
      const availableCredits = availableCreditsByClientId.get(client.id) ?? 0;
      return {
        ...client,
        availableCredits,
        hasAvailableCredits: availableCredits > 0,
      };
    }),
  };
}

export async function createAdminSession(input: {
  classTemplateId: string;
  teacherId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: StudioSessionStatus;
  isPublished: boolean;
}) {
  const template = await prisma.classTemplate.findUnique({
    where: { id: input.classTemplateId },
    select: {
      id: true,
      classTypeId: true,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  if (input.endsAt <= input.startsAt) {
    throw new Error("INVALID_SESSION_TIME_RANGE");
  }

  return prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: template.classTypeId,
      teacherId: input.teacherId,
      title: input.title.trim(),
      description: toNullable(input.description),
      location: toNullable(input.location),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      status: input.status,
      isPublished: input.isPublished,
    },
  });
}

export async function createAdminRecurringSessions(input: {
  classTemplateId: string;
  teacherId: string;
  title: string;
  description?: string;
  location?: string;
  capacity: number;
  status: StudioSessionStatus;
  isPublished: boolean;
  schedule: AdminRecurringSessionScheduleInput;
}) {
  if (input.schedule.repeatEveryWeeks < 1) {
    throw new Error("INVALID_RECURRENCE_INTERVAL");
  }

  if (input.schedule.weekdays.length < 1) {
    throw new Error("INVALID_RECURRENCE_WEEKDAYS");
  }

  const startMinutes = parseTimeToMinutes(input.schedule.startTime);
  const endMinutes = parseTimeToMinutes(input.schedule.endTime);
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes) || endMinutes <= startMinutes) {
    throw new Error("INVALID_SESSION_TIME_RANGE");
  }

  if (input.schedule.endMode === "on_date" && !input.schedule.endDate) {
    throw new Error("RECURRENCE_END_DATE_REQUIRED");
  }

  if (
    input.schedule.endMode === "after_occurrences" &&
    (!input.schedule.occurrences || input.schedule.occurrences < 1)
  ) {
    throw new Error("RECURRENCE_OCCURRENCES_REQUIRED");
  }

  const template = await prisma.classTemplate.findUnique({
    where: { id: input.classTemplateId },
    select: {
      id: true,
      classTypeId: true,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  const occurrences = buildRecurringOccurrences(input.schedule);
  if (occurrences.length < 1) {
    throw new Error("NO_RECURRENCE_OCCURRENCES");
  }

  const perWeekdayEndDate =
    input.schedule.endMode === "on_date" && input.schedule.endDate
      ? input.schedule.endDate
      : input.schedule.endMode === "after_occurrences"
        ? occurrences[occurrences.length - 1]?.startsAt ?? null
        : null;

  return prisma.$transaction(async (tx) => {
    const uniqueWeekdays = [...new Set(input.schedule.weekdays)];
    const recurringRulesByWeekday = new Map<Weekday, string>();

    for (const weekday of uniqueWeekdays) {
      const rule = await tx.recurringRule.upsert({
        where: {
          classTemplateId_weekday_startTime_startDate: {
            classTemplateId: template.id,
            weekday,
            startTime: input.schedule.startTime,
            startDate: input.schedule.startsOn,
          },
        },
        create: {
          classTemplateId: template.id,
          weekday,
          startTime: input.schedule.startTime,
          startDate: input.schedule.startsOn,
          endDate: perWeekdayEndDate ?? null,
          isActive: true,
        },
        update: {
          endDate: perWeekdayEndDate ?? null,
          isActive: true,
        },
        select: {
          id: true,
          weekday: true,
        },
      });
      recurringRulesByWeekday.set(rule.weekday, rule.id);
    }

    await tx.studioSession.createMany({
      data: occurrences.map((occurrence) => ({
        classTemplateId: template.id,
        recurringRuleId: recurringRulesByWeekday.get(occurrence.weekday) ?? null,
        classTypeId: template.classTypeId,
        teacherId: input.teacherId,
        title: input.title.trim(),
        description: toNullable(input.description),
        location: toNullable(input.location),
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        capacity: input.capacity,
        status: input.status,
        isPublished: input.isPublished,
      })),
      skipDuplicates: true,
    });

    return {
      createdSessionCount: occurrences.length,
    };
  });
}

export async function updateAdminSession(
  id: string,
  input: {
    classTemplateId: string;
    teacherId: string;
    title: string;
    description?: string;
    location?: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    status: StudioSessionStatus;
    isPublished: boolean;
  },
) {
  const template = await prisma.classTemplate.findUnique({
    where: { id: input.classTemplateId },
    select: {
      id: true,
      classTypeId: true,
    },
  });

  if (!template) {
    throw new Error("TEMPLATE_NOT_FOUND");
  }

  return prisma.studioSession.update({
    where: { id },
    data: {
      classTemplateId: template.id,
      classTypeId: template.classTypeId,
      teacherId: input.teacherId,
      title: input.title.trim(),
      description: toNullable(input.description),
      location: toNullable(input.location),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      status: input.status,
      isPublished: input.isPublished,
    },
  });
}

type SessionManagerActor = {
  userId: string;
  role: Role;
};

async function getNextConsumableCreditEntitlementForScope(input: {
  clientId: string;
  requiredScope: EntitlementScope;
}): Promise<{ entitlementId: string } | null> {
  const now = new Date();
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: input.clientId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
      entitlementScope: {
        in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  if (entitlements.length === 0) {
    return null;
  }

  const balances = await prisma.creditLedgerEntry.groupBy({
    by: ["entitlementId"],
    where: {
      clientId: input.clientId,
      entitlementId: {
        in: entitlements.map((entitlement) => entitlement.id),
      },
    },
    _sum: {
      amount: true,
    },
  });

  const balanceByEntitlementId = new Map(
    balances.map((row) => [row.entitlementId, row._sum.amount ?? 0]),
  );

  const eligible = entitlements
    .map((entitlement) => ({
      entitlementId: entitlement.id,
      createdAt: entitlement.createdAt,
      expiresAt: entitlement.expiresAt,
      balance: balanceByEntitlementId.get(entitlement.id) ?? 0,
    }))
    .filter((entitlement) => entitlement.balance > 0);

  if (eligible.length === 0) {
    return null;
  }

  eligible.sort((a, b) => {
    const aExpiry = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) {
      return aExpiry - bExpiry;
    }

    const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    return a.entitlementId.localeCompare(b.entitlementId);
  });

  return {
    entitlementId: eligible[0]!.entitlementId,
  };
}

async function getClientAvailableCreditsByScope(input: {
  clientIds: string[];
  requiredScope: EntitlementScope;
}): Promise<Map<string, number>> {
  if (input.clientIds.length === 0) {
    return new Map();
  }

  const now = new Date();
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: {
        in: input.clientIds,
      },
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
      entitlementScope: {
        in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      clientId: true,
    },
  });

  if (entitlements.length === 0) {
    return new Map();
  }

  const entitlementIdToClientId = new Map(
    entitlements.map((entitlement) => [entitlement.id, entitlement.clientId]),
  );

  const balances = await prisma.creditLedgerEntry.groupBy({
    by: ["entitlementId"],
    where: {
      entitlementId: {
        in: [...entitlementIdToClientId.keys()],
      },
    },
    _sum: {
      amount: true,
    },
  });

  const creditsByClientId = new Map<string, number>();
  for (const balance of balances) {
    if (!balance.entitlementId) {
      continue;
    }

    const clientId = entitlementIdToClientId.get(balance.entitlementId);
    if (!clientId) {
      continue;
    }

    const entitlementBalance = balance._sum.amount ?? 0;
    if (entitlementBalance <= 0) {
      continue;
    }

    creditsByClientId.set(clientId, (creditsByClientId.get(clientId) ?? 0) + entitlementBalance);
  }

  return creditsByClientId;
}

export async function addSessionAttendeeByManager(input: {
  studioSessionId: string;
  clientId: string;
  note?: string;
  actor: SessionManagerActor;
}) {
  const normalizedNote = input.note?.trim() ?? "";
  const now = new Date();

  const [actorUser, clientUser, session] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: input.actor.userId },
      select: {
        id: true,
        role: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: input.clientId },
      select: {
        id: true,
        role: true,
        email: true,
        name: true,
      },
    }),
    prisma.studioSession.findUnique({
      where: { id: input.studioSessionId },
      select: {
        id: true,
        teacherId: true,
        title: true,
        startsAt: true,
        capacity: true,
        status: true,
        classType: {
          select: {
            category: {
              select: {
                slug: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!actorUser || (actorUser.role !== Role.ADMIN && actorUser.role !== Role.MASTER_ADMIN && actorUser.role !== Role.TEACHER)) {
    throw new Error("SESSION_MANAGER_FORBIDDEN");
  }

  if (!clientUser || clientUser.role !== Role.CLIENT) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }
  if (actorUser.role === Role.TEACHER && session.teacherId !== actorUser.id) {
    throw new Error("TEACHER_SESSION_FORBIDDEN");
  }

  if (session.status !== StudioSessionStatus.SCHEDULED || session.startsAt <= now) {
    throw new Error("SESSION_NOT_BOOKABLE");
  }

  const existingActiveBooking = await prisma.booking.findFirst({
    where: {
      studioSessionId: session.id,
      clientId: clientUser.id,
      status: {
        in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
      },
    },
    select: {
      id: true,
      status: true,
      selectedEntitlementId: true,
    },
  });

  if (existingActiveBooking) {
    return {
      bookingId: existingActiveBooking.id,
      status: existingActiveBooking.status,
      usedCreditEntitlementId: existingActiveBooking.selectedEntitlementId,
      overrideApplied: false,
    };
  }

  const activeBookingCount = await prisma.booking.count({
    where: {
      studioSessionId: session.id,
      status: {
        in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
      },
    },
  });

  if (activeBookingCount >= session.capacity) {
    throw new Error("SESSION_FULL");
  }

  const requiredScope = toEntitlementScopeFromCategorySlug(session.classType.category.slug);
  const entitlement = await getNextConsumableCreditEntitlementForScope({
    clientId: clientUser.id,
    requiredScope,
  });
  const overrideWithoutCredits = !entitlement;

  if (overrideWithoutCredits && actorUser.role === Role.TEACHER) {
    throw new Error("TEACHER_CREDIT_OVERRIDE_FORBIDDEN");
  }

  if (overrideWithoutCredits && !normalizedNote) {
    throw new Error("SESSION_OVERRIDE_NOTE_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const createdBooking = await tx.booking.create({
      data: {
        clientId: clientUser.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        bookingIntent: BookingIntent.USE_PLAN,
        paymentSelection: entitlement ? BookingPaymentSelection.EXISTING_PLAN : null,
        selectedEntitlementId: entitlement?.entitlementId ?? null,
        draftAmountMinor: 0,
        draftCurrencyCode: "EUR",
        bookedAt: now,
        customerName: clientUser.name,
        customerEmail: clientUser.email,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (entitlement) {
      await tx.creditLedgerEntry.create({
        data: {
          clientId: clientUser.id,
          entitlementId: entitlement.entitlementId,
          bookingId: createdBooking.id,
          entryType: CreditLedgerEntryType.CONSUME,
          amount: -1,
          createdById: actorUser.id,
          happenedAt: now,
          notes: `Credit consumed from session manager attendee add${normalizedNote ? `: ${normalizedNote}` : "."}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: actorUser.id,
        actionType: overrideWithoutCredits ? "SESSION_ATTENDEE_ADD_OVERRIDE" : "SESSION_ATTENDEE_ADD",
        entityType: "Booking",
        entityId: createdBooking.id,
        metadata: {
          sessionId: session.id,
          clientId: clientUser.id,
          usedCreditEntitlementId: entitlement?.entitlementId ?? null,
          note: normalizedNote || null,
        },
      },
    });

    return {
      bookingId: createdBooking.id,
      status: createdBooking.status,
      usedCreditEntitlementId: entitlement?.entitlementId ?? null,
      overrideApplied: overrideWithoutCredits,
    };
  });
}

export async function removeSessionAttendeeByManager(input: {
  studioSessionId: string;
  bookingId: string;
  note?: string;
  actor: SessionManagerActor;
}) {
  const normalizedNote = input.note?.trim() ?? "";
  const now = new Date();

  const actorUser = await prisma.user.findUnique({
    where: { id: input.actor.userId },
    select: {
      id: true,
      role: true,
    },
  });

  if (!actorUser || (actorUser.role !== Role.ADMIN && actorUser.role !== Role.MASTER_ADMIN && actorUser.role !== Role.TEACHER)) {
    throw new Error("SESSION_MANAGER_FORBIDDEN");
  }

  const [session, booking] = await prisma.$transaction([
    prisma.studioSession.findUnique({
      where: { id: input.studioSessionId },
      select: {
        id: true,
        teacherId: true,
      },
    }),
    prisma.booking.findFirst({
      where: {
        id: input.bookingId,
        studioSessionId: input.studioSessionId,
      },
      select: {
        id: true,
        clientId: true,
        status: true,
        selectedEntitlementId: true,
        creditRefundedAt: true,
      },
    }),
  ]);

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (actorUser.role === Role.TEACHER && session.teacherId !== actorUser.id) {
    throw new Error("TEACHER_SESSION_FORBIDDEN");
  }

  if (!booking) {
    throw new Error("SESSION_ATTENDEE_NOT_FOUND");
  }

  if (booking.status === BookingStatus.CANCELLED) {
    return {
      bookingId: booking.id,
      restoredCredit: false,
      alreadyCancelled: true,
    };
  }

  if (!booking.clientId) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  const bookingClientId = booking.clientId;

  const promotionResult = await prisma.$transaction(async (tx) => {
    let restoredCredit = false;

    if (booking.selectedEntitlementId && !booking.creditRefundedAt) {
      const consumed = await tx.creditLedgerEntry.findFirst({
        where: {
          bookingId: booking.id,
          entitlementId: booking.selectedEntitlementId,
          entryType: CreditLedgerEntryType.CONSUME,
        },
        select: { id: true },
      });

      const restoreExists = await tx.creditLedgerEntry.findFirst({
        where: {
          bookingId: booking.id,
          entitlementId: booking.selectedEntitlementId,
          entryType: CreditLedgerEntryType.RESTORE,
        },
        select: { id: true },
      });

      if (consumed && !restoreExists) {
        await tx.creditLedgerEntry.create({
          data: {
            clientId: bookingClientId,
            entitlementId: booking.selectedEntitlementId,
            bookingId: booking.id,
            entryType: CreditLedgerEntryType.RESTORE,
            amount: 1,
            createdById: actorUser.id,
            happenedAt: now,
            notes: `Credit restored from session attendee removal${normalizedNote ? `: ${normalizedNote}` : "."}`,
          },
        });
        restoredCredit = true;
      }
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: now,
        cancelledById: actorUser.id,
        cancellationReason: normalizedNote || "Cancelled by session manager from session edit page.",
        creditRefundedAt: restoredCredit ? now : booking.creditRefundedAt,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUser.id,
        actionType: "SESSION_ATTENDEE_REMOVE",
        entityType: "Booking",
        entityId: booking.id,
        metadata: {
          sessionId: input.studioSessionId,
          clientId: bookingClientId,
          restoredCredit,
          note: normalizedNote || null,
        },
      },
    });

    const promotionResult = await promoteWaitlistAfterCancellationWithinTx(tx, {
      actorUserId: actorUser.id,
      now,
      studioSessionId: input.studioSessionId,
      triggerSource: "SESSION_MANAGER_BOOKING_CANCELLATION",
    });

    return {
      bookingId: booking.id,
      restoredCredit,
      alreadyCancelled: false,
      waitlistNotifications: promotionResult.notifications,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await Promise.all(
    promotionResult.waitlistNotifications.map(async (promotion) => {
      try {
        await sendWaitlistPromotionNotification(promotion);
      } catch (error) {
        console.error("[admin-service] waitlist promotion notification failed", {
          waitlistEntryId: promotion.waitlistEntryId,
          bookingId: promotion.bookingId,
          error,
        });
      }
    }),
  );

  return {
    bookingId: promotionResult.bookingId,
    restoredCredit: promotionResult.restoredCredit,
    alreadyCancelled: promotionResult.alreadyCancelled,
  };
}

export async function getAdminPlansData(): Promise<AdminPlanItem[]> {
  const products = await prisma.product.findMany({
    where: { isArchived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      prices: {
        where: {
          isActive: true,
          isArchived: false,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          unitAmountMinor: true,
          currencyCode: true,
          priceType: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
        },
      },
    },
  });

  return products.map((item) => {
    const currentPrice = item.prices[0] ?? null;

    return {
      id: item.id,
      name: item.name,
      productType: item.productType,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
      currentPriceAmountMinor: currentPrice?.unitAmountMinor ?? null,
      currentPriceCurrencyCode: currentPrice?.currencyCode ?? null,
      currentPriceType: currentPrice?.priceType ?? null,
      currentBillingInterval: currentPrice?.billingInterval ?? null,
      currentBillingIntervalCount: currentPrice?.billingIntervalCount ?? null,
      isCheckoutReady: Boolean(currentPrice?.stripePriceId),
    };
  });
}

export async function getAdminPlanById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      sortOrder: true,
      prices: {
        where: {
          isActive: true,
          isArchived: false,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          id: true,
          name: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
        },
      },
    },
  });
}

export async function createAdminPlan(input: {
  name: string;
  description?: string;
  productType: ProductType;
  isActive: boolean;
  sortOrder: number;
  priceName?: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval?: BillingInterval;
  billingIntervalCount?: number;
}) {
  const name = input.name.trim();
  const slugBase = generatePlanSlug(name);
  const slug = slugBase || `plan-${Date.now()}`;
  const priceName = input.priceName?.trim() || `${name} Price`;
  const normalizedDescription = toNullable(input.description);
  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();

  const created = await prisma.product.create({
    data: {
      name,
      slug,
      description: normalizedDescription,
      productType: input.productType,
      isActive: input.isActive,
      isArchived: false,
      sortOrder: input.sortOrder,
      prices: {
        create: {
          lookupKey: `admin-${slug}-${Date.now()}`,
          name: priceName,
          priceType: input.priceType,
          currencyCode: normalizedCurrencyCode,
          unitAmountMinor: input.unitAmountMinor,
          billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval : null,
          billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
          isActive: true,
          isArchived: false,
        },
      },
    },
    select: {
      id: true,
      prices: {
        where: { isActive: true, isArchived: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  await ensureEntitlementRuleForProduct({
    productId: created.id,
    productType: input.productType,
    prismaClient: prisma,
  });

  const activePriceId = created.prices[0]?.id;
  if (activePriceId) {
    const stripeProvision = await provisionPlanOnStripe({
      existingStripeProductId: null,
      productName: name,
      productDescription: normalizedDescription,
      priceName,
      priceType: input.priceType,
      currencyCode: normalizedCurrencyCode,
      unitAmountMinor: input.unitAmountMinor,
      billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval ?? null : null,
      billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
    });

    if (stripeProvision.ok) {
      await prisma.price.update({
        where: { id: activePriceId },
        data: { stripePriceId: stripeProvision.stripePriceId },
      });
    }
  }

  return prisma.product.findUnique({ where: { id: created.id } });
}

export async function updateAdminPlan(
  id: string,
  input: {
    name: string;
    description?: string;
    productType: ProductType;
    isActive: boolean;
    sortOrder: number;
    priceName?: string;
    priceType: PriceType;
    currencyCode: string;
    unitAmountMinor: number;
    billingInterval?: BillingInterval;
    billingIntervalCount?: number;
  },
) {
  const name = input.name.trim();
  const slugBase = generatePlanSlug(name);
  const slug = slugBase || `plan-${Date.now()}`;
  const priceName = input.priceName?.trim() || `${name} Price`;
  const normalizedDescription = toNullable(input.description);
  const normalizedCurrencyCode = input.currencyCode.trim().toUpperCase();

  const latestStripePrice = await prisma.price.findFirst({
    where: {
      productId: id,
      stripePriceId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { stripePriceId: true },
  });

  const existingStripeProductId = latestStripePrice?.stripePriceId
    ? await resolveStripeProductIdFromPrice(latestStripePrice.stripePriceId)
    : null;

  const result = await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: {
        name,
        slug,
        description: normalizedDescription,
        productType: input.productType,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
    });

    await tx.price.updateMany({
      where: {
        productId: id,
        isActive: true,
        isArchived: false,
      },
      data: {
        isActive: false,
      },
    });

    const createdPrice = await tx.price.create({
      data: {
        productId: id,
        lookupKey: `admin-${slug}-${Date.now()}`,
        name: priceName,
        priceType: input.priceType,
        currencyCode: normalizedCurrencyCode,
        unitAmountMinor: input.unitAmountMinor,
        billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval : null,
        billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });

    await ensureEntitlementRuleForProduct({
      productId: id,
      productType: input.productType,
      prismaClient: tx,
    });

    return createdPrice;
  });

  const stripeProvision = await provisionPlanOnStripe({
    existingStripeProductId,
    productName: name,
    productDescription: normalizedDescription,
    priceName,
    priceType: input.priceType,
    currencyCode: normalizedCurrencyCode,
    unitAmountMinor: input.unitAmountMinor,
    billingInterval: input.priceType === PriceType.RECURRING ? input.billingInterval ?? null : null,
    billingIntervalCount: input.priceType === PriceType.RECURRING ? input.billingIntervalCount ?? 1 : null,
  });

  if (stripeProvision.ok) {
    await prisma.price.update({
      where: { id: result.id },
      data: { stripePriceId: stripeProvision.stripePriceId },
    });
  }

  return prisma.product.findUnique({ where: { id } });
}

export async function getBookings(input: {
  page: number;
  pageSize?: number;
  filter?: AdminBookingStatusFilter;
  query?: string;
}): Promise<AdminBookingsPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const query = input.query?.trim() ?? "";
  const skip = (page - 1) * pageSize;
  const status = getAdminBookingStatus(input.filter ?? "all");

  const where: Prisma.BookingWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            {
              customerName: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              customerEmail: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              client: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              client: {
                email: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              studioSession: {
                title: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
      : {}),
  };

  const [totalItems, bookings] = await prisma.$transaction([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ bookedAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        paymentSelection: true,
        bookedAt: true,
        customerName: true,
        customerEmail: true,
        client: {
          select: {
            name: true,
            email: true,
          },
        },
        studioSession: {
          select: {
            title: true,
            startsAt: true,
          },
        },
      },
    }),
  ]);

  return {
    data: bookings.map((item) => ({
      id: item.id,
      status: item.status,
      paymentSelection: item.paymentSelection,
      bookedAt: item.bookedAt.toISOString(),
      customerName: item.customerName ?? item.client?.name ?? "Guest",
      customerEmail: item.customerEmail ?? item.client?.email ?? "-",
      sessionTitle: item.studioSession.title,
      startsAt: item.studioSession.startsAt.toISOString(),
    })),
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function getAdminBookingsData(): Promise<AdminBookingItem[]> {
  const page = await getBookings({ page: 1, pageSize: 100 });
  return page.data;
}

function mapAdminUserItem(user: {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  marketingSubscriptionStatus: MarketingSubscriptionStatus;
  marketingSegments: Array<{ segment: { name: string } }>;
}): AdminUserItem {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    marketingSubscriptionStatus: user.marketingSubscriptionStatus,
    marketingSegmentNames: user.marketingSegments.map((item) => item.segment.name).sort((a, b) => a.localeCompare(b)),
  };
}

async function getAdminUsersRolePage(input: {
  roles: Role[];
  page: number;
  pageSize: number;
  query: string;
}): Promise<AdminUsersRolePageData> {
  const where: Prisma.UserWhereInput = {
    role: {
      in: input.roles,
    },
    ...(input.query
      ? {
          OR: [
            {
              name: {
                contains: input.query,
                mode: "insensitive",
              },
            },
            {
              email: {
                contains: input.query,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };

  const skip = (input.page - 1) * input.pageSize;
  const [totalItems, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: input.pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        marketingSubscriptionStatus: true,
        marketingSegments: {
          select: {
            segment: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    page: input.page,
    pageSize: input.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / input.pageSize)),
    items: rows.map(mapAdminUserItem),
  };
}

export async function getAdminUsersGroupedPageData(input: {
  query?: string;
  pageSize?: number;
  masterAdminsPage: number;
  adminsPage: number;
  teachersPage: number;
  clientsPage: number;
}): Promise<AdminUsersGroupedPageData> {
  const query = input.query?.trim() ?? "";
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const normalizePage = (value: number) => Math.max(1, Math.floor(value));

  const [masterAdmins, admins, teachers, clients] = await Promise.all([
    getAdminUsersRolePage({
      roles: [Role.MASTER_ADMIN],
      page: normalizePage(input.masterAdminsPage),
      pageSize,
      query,
    }),
    getAdminUsersRolePage({
      roles: [Role.ADMIN],
      page: normalizePage(input.adminsPage),
      pageSize,
      query,
    }),
    getAdminUsersRolePage({
      roles: [Role.TEACHER],
      page: normalizePage(input.teachersPage),
      pageSize,
      query,
    }),
    getAdminUsersRolePage({
      roles: [Role.CLIENT],
      page: normalizePage(input.clientsPage),
      pageSize,
      query,
    }),
  ]);

  return {
    query,
    masterAdmins,
    admins,
    teachers,
    clients,
  };
}

export async function getAdminAdminsPageData(input: {
  query?: string;
  page: number;
  pageSize?: number;
}): Promise<AdminUsersRolePageData> {
  const query = input.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));

  return getAdminUsersRolePage({
    roles: [Role.MASTER_ADMIN, Role.ADMIN],
    page,
    pageSize,
    query,
  });
}

export async function getAdminTeachersPageData(input: {
  query?: string;
  page: number;
  pageSize?: number;
}): Promise<AdminUsersRolePageData> {
  const query = input.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));

  return getAdminUsersRolePage({
    roles: [Role.TEACHER],
    page,
    pageSize,
    query,
  });
}

export async function getAdminClientsPageData(input: {
  query?: string;
  page: number;
  pageSize?: number;
}): Promise<AdminUsersRolePageData> {
  const query = input.query?.trim() ?? "";
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));

  return getAdminUsersRolePage({
    roles: [Role.CLIENT],
    page,
    pageSize,
    query,
  });
}

export async function getAdminClientStats(): Promise<AdminClientStats> {
  const now = new Date();
  const [clients, historicalRows, activeRows, totalSubscriptions] = await Promise.all([
    prisma.user.findMany({
      where: { role: Role.CLIENT },
      select: { id: true },
    }),
    prisma.subscriptionContract.findMany({
      where: {
        client: {
          role: Role.CLIENT,
        },
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.subscriptionContract.findMany({
      where: {
        client: {
          role: Role.CLIENT,
        },
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: {
          gt: now,
        },
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.subscriptionContract.count({
      where: {
        client: {
          role: Role.CLIENT,
        },
      },
    }),
  ]);

  const totalClients = clients.length;
  const clientIdsWithHistory = new Set(historicalRows.map((row) => row.clientId));
  const clientIdsWithActiveSubscription = new Set(activeRows.map((row) => row.clientId));

  const subscribedClients = clientIdsWithActiveSubscription.size;
  const neverSubscribedClients = Math.max(0, totalClients - clientIdsWithHistory.size);
  const unsubscribedClients = Math.max(0, clientIdsWithHistory.size - subscribedClients);

  return {
    totalClients,
    neverSubscribedClients,
    subscribedClients,
    unsubscribedClients,
    totalSubscriptions,
  };
}

function mapAdminSiteWeeklyScheduleEntry(entry: {
  id: string;
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  serviceId: string | null;
  label: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AdminSiteWeeklyScheduleEntry {
  return {
    id: entry.id,
    dayOfWeek: entry.dayOfWeek,
    startTime: entry.startTime,
    endTime: entry.endTime,
    serviceId: entry.serviceId,
    label: entry.label,
    displayOrder: entry.displayOrder,
    isActive: entry.isActive,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function normalizeScheduleTime(value: string): string {
  const normalized = value.trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) {
    throw new Error("INVALID_SITE_SCHEDULE_TIME");
  }
  return normalized;
}

function validateScheduleTimeRange(startTime: string, endTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    throw new Error("INVALID_SITE_SCHEDULE_TIME_RANGE");
  }
}

async function resolveSiteScheduleService(serviceId: string): Promise<{ id: string; name: string }> {
  const normalizedServiceId = serviceId.trim();
  if (!normalizedServiceId) {
    throw new Error("INVALID_SITE_SCHEDULE_SERVICE");
  }

  const classType = await prisma.classType.findUnique({
    where: { id: normalizedServiceId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!classType) {
    throw new Error("CLASS_NOT_FOUND");
  }

  return classType;
}

export async function listAdminSiteScheduleServiceOptions(): Promise<AdminSiteScheduleServiceOption[]> {
  const services = await prisma.classType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });

  return services.map((service) => ({
    id: service.id,
    name: service.name,
  }));
}

export async function listAdminSiteWeeklyScheduleEntries(): Promise<AdminSiteWeeklyScheduleEntry[]> {
  const entries = await prisma.siteWeeklyScheduleEntry.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { displayOrder: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      serviceId: true,
      label: true,
      displayOrder: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return entries.map(mapAdminSiteWeeklyScheduleEntry);
}

export async function createAdminSiteWeeklyScheduleEntry(input: {
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  serviceId: string;
  displayOrder: number;
  isActive: boolean;
}): Promise<AdminSiteWeeklyScheduleEntry> {
  const startTime = normalizeScheduleTime(input.startTime);
  const endTime = normalizeScheduleTime(input.endTime);
  validateScheduleTimeRange(startTime, endTime);
  const service = await resolveSiteScheduleService(input.serviceId);

  const created = await prisma.siteWeeklyScheduleEntry.create({
    data: {
      dayOfWeek: input.dayOfWeek,
      startTime,
      endTime,
      serviceId: service.id,
      label: service.name,
      displayOrder: Math.max(0, Math.floor(input.displayOrder)),
      isActive: input.isActive,
    },
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      serviceId: true,
      label: true,
      displayOrder: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return mapAdminSiteWeeklyScheduleEntry(created);
}

export async function updateAdminSiteWeeklyScheduleEntry(
  id: string,
  input: {
    dayOfWeek: Weekday;
    startTime: string;
    endTime: string;
    serviceId: string;
    displayOrder: number;
    isActive: boolean;
  },
): Promise<AdminSiteWeeklyScheduleEntry> {
  const startTime = normalizeScheduleTime(input.startTime);
  const endTime = normalizeScheduleTime(input.endTime);
  validateScheduleTimeRange(startTime, endTime);
  const service = await resolveSiteScheduleService(input.serviceId);

  const updated = await prisma.siteWeeklyScheduleEntry.update({
    where: { id },
    data: {
      dayOfWeek: input.dayOfWeek,
      startTime,
      endTime,
      serviceId: service.id,
      label: service.name,
      displayOrder: Math.max(0, Math.floor(input.displayOrder)),
      isActive: input.isActive,
    },
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      serviceId: true,
      label: true,
      displayOrder: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return mapAdminSiteWeeklyScheduleEntry(updated);
}

export async function deleteAdminSiteWeeklyScheduleEntry(id: string): Promise<void> {
  await prisma.siteWeeklyScheduleEntry.delete({
    where: { id },
  });
}

export async function getAdminCancellationPeriodHours(): Promise<number> {
  const policy = await prisma.bookingPolicy.findFirst({
    where: {
      scope: "GLOBAL",
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      cancellationCutoffHours: true,
    },
  });

  return normalizeBookingCancellationWindowHours(policy?.cancellationCutoffHours ?? 24);
}

export async function updateAdminCancellationPeriodHours(hours: number): Promise<number> {
  const normalized = Number(hours);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error("INVALID_CANCELLATION_CUTOFF_HOURS");
  }

  const policy = await prisma.bookingPolicy.upsert({
    where: { scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      cancellationCutoffHours: normalized,
    },
    update: {
      cancellationCutoffHours: normalized,
    },
    select: {
      cancellationCutoffHours: true,
    },
  });

  return normalizeBookingCancellationWindowHours(policy.cancellationCutoffHours);
}

export type AdminAttendanceWindowPolicy = {
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
};

export async function getAdminAttendanceWindowPolicy(): Promise<AdminAttendanceWindowPolicy> {
  const policy = await prisma.bookingPolicy.findFirst({
    where: { scope: "GLOBAL" },
    orderBy: { createdAt: "asc" },
    select: {
      checkInOpensMinutesBefore: true,
      checkInClosesMinutesAfter: true,
    },
  });

  return {
    checkInOpensMinutesBefore: policy?.checkInOpensMinutesBefore ?? 15,
    checkInClosesMinutesAfter: policy?.checkInClosesMinutesAfter ?? 10,
  };
}

export async function updateAdminAttendanceWindowPolicy(input: {
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
}): Promise<AdminAttendanceWindowPolicy> {
  const opens = Number(input.checkInOpensMinutesBefore);
  const closes = Number(input.checkInClosesMinutesAfter);

  if (!Number.isInteger(opens) || opens < 0) {
    throw new Error("INVALID_CHECKIN_OPENS_MINUTES_BEFORE");
  }
  if (!Number.isInteger(closes) || closes < 0) {
    throw new Error("INVALID_CHECKIN_CLOSES_MINUTES_AFTER");
  }

  const policy = await prisma.bookingPolicy.upsert({
    where: { scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      cancellationCutoffHours: 24,
      checkInOpensMinutesBefore: opens,
      checkInClosesMinutesAfter: closes,
    },
    update: {
      checkInOpensMinutesBefore: opens,
      checkInClosesMinutesAfter: closes,
    },
    select: {
      checkInOpensMinutesBefore: true,
      checkInClosesMinutesAfter: true,
    },
  });

  return {
    checkInOpensMinutesBefore: policy.checkInOpensMinutesBefore,
    checkInClosesMinutesAfter: policy.checkInClosesMinutesAfter,
  };
}

export async function getAdminUsersData(): Promise<AdminUserItem[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      marketingSubscriptionStatus: true,
      marketingSegments: {
        select: {
          segment: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  return users.map(mapAdminUserItem);
}

export async function getAdminUserById(id: string): Promise<AdminUserDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      image: true,
      marketingSubscriptionStatus: true,
      marketingSegments: {
        select: {
          segmentId: true,
        },
      },
      clientProfile: {
        select: {
          phone: true,
          notes: true,
        },
      },
      teacherProfile: {
        select: {
          phone: true,
          bio: true,
          specialties: true,
          certifications: true,
          hireDate: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const primaryPhone =
    user.role === Role.TEACHER
      ? user.teacherProfile?.phone ?? user.clientProfile?.phone ?? ""
      : user.clientProfile?.phone ?? user.teacherProfile?.phone ?? "";

  return {
    id: user.id,
    name: user.name,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    image: user.image ?? "",
    phone: primaryPhone,
    notes: user.clientProfile?.notes ?? "",
    bio: user.teacherProfile?.bio ?? "",
    specialties: user.teacherProfile?.specialties ?? [],
    certifications: user.teacherProfile?.certifications ?? [],
    hireDate: user.teacherProfile?.hireDate?.toISOString() ?? null,
    marketingSubscriptionStatus: user.marketingSubscriptionStatus,
    marketingSegmentIds: user.marketingSegments.map((item) => item.segmentId),
  };
}

export async function getAdminClientActivityData(clientId: string): Promise<AdminClientActivityData> {
  const now = new Date();
  const [plansBought, classesBooked, classesCancelled, outstandingMemberships, creditEntitlements, creditProducts] =
    await prisma.$transaction([
      prisma.orderItem.findMany({
        where: {
          order: {
            clientId,
            status: OrderStatus.PAID,
          },
          product: {
            productType: {
              in: [ProductType.CLASS_PACK, ProductType.UNLIMITED_MEMBERSHIP, ProductType.INTRO_OFFER],
            },
          },
        },
        orderBy: [{ order: { placedAt: "desc" } }, { createdAt: "desc" }],
        select: {
          orderId: true,
          productNameSnapshot: true,
          priceNameSnapshot: true,
          lineTotalAmountMinor: true,
          currencyCode: true,
          order: {
            select: {
              placedAt: true,
            },
          },
        },
      }),
      prisma.booking.count({
        where: {
          clientId,
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
          },
        },
      }),
      prisma.booking.count({
        where: {
          clientId,
          status: BookingStatus.CANCELLED,
        },
      }),
      prisma.subscriptionContract.findMany({
        where: {
          clientId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { gt: now },
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        },
        orderBy: { currentPeriodEnd: "asc" },
        select: {
          id: true,
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.clientEntitlement.findMany({
        where: {
          clientId,
          status: ClientEntitlementStatus.ACTIVE,
          entitlementType: {
            in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
          },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          status: true,
          expiresAt: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.product.findMany({
        where: {
          isActive: true,
          isArchived: false,
          entitlementRules: {
            some: {
              isActive: true,
              entitlementType: {
                in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

  const entitlementBalances =
    creditEntitlements.length > 0
      ? await prisma.creditLedgerEntry.groupBy({
          by: ["entitlementId"],
          where: {
            clientId,
            entitlementId: { in: creditEntitlements.map((entitlement) => entitlement.id) },
          },
          _sum: {
            amount: true,
          },
        })
      : [];
  const balanceByEntitlementId = new Map(
    entitlementBalances.map((row) => [row.entitlementId, row._sum.amount ?? 0]),
  );

  const entitlementRows = creditEntitlements
    .map((entitlement) => ({
      entitlementId: entitlement.id,
      productName: entitlement.product.name,
      status: entitlement.status,
      expiresAt: entitlement.expiresAt?.toISOString() ?? null,
      remainingCredits: balanceByEntitlementId.get(entitlement.id) ?? 0,
    }))
    .filter((entitlement) => entitlement.remainingCredits > 0);

  const creditsRemaining = entitlementRows.reduce((sum, row) => sum + row.remainingCredits, 0);
  const nextCreditExpiration =
    entitlementRows
      .map((row) => row.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

  return {
    plansBought: plansBought.map((entry) => ({
      orderId: entry.orderId,
      productName: entry.productNameSnapshot,
      priceName: entry.priceNameSnapshot,
      amountMinor: entry.lineTotalAmountMinor,
      currencyCode: entry.currencyCode,
      purchasedAt: entry.order.placedAt.toISOString(),
    })),
    classesBooked,
    classesCancelled,
    outstandingMemberships: outstandingMemberships.map((subscription) => ({
      id: subscription.id,
      productName: subscription.product.name,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    })),
    creditEntitlements: entitlementRows,
    creditsRemaining,
    nextCreditExpiration,
    eligibleCreditProducts: creditProducts,
  };
}

export async function adjustAdminClientCredits(input: {
  clientId: string;
  adminUserId: string;
  amount: number;
  entitlementId?: string;
  productId?: string;
  expiresAt?: Date | null;
  reason?: string;
}) {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error("INVALID_CREDIT_AMOUNT");
  }

  const now = new Date();
  const [clientRecord, adminRecord] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: input.clientId },
      select: { id: true, role: true },
    }),
    prisma.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!clientRecord || clientRecord.role !== Role.CLIENT) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  if (!adminRecord || (adminRecord.role !== Role.ADMIN && adminRecord.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  if (input.entitlementId) {
    const entitlement = await prisma.clientEntitlement.findFirst({
      where: {
        id: input.entitlementId,
        clientId: input.clientId,
        entitlementType: {
          in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
        },
      },
      select: {
        id: true,
      },
    });

    if (!entitlement) {
      throw new Error("ENTITLEMENT_NOT_FOUND");
    }

    return prisma.$transaction(async (tx) => {
      if (input.expiresAt !== undefined) {
        await tx.clientEntitlement.update({
          where: { id: entitlement.id },
          data: { expiresAt: input.expiresAt ?? null },
        });
      }

      await tx.creditLedgerEntry.create({
        data: {
          clientId: clientRecord.id,
          entitlementId: entitlement.id,
          entryType: CreditLedgerEntryType.ADJUSTMENT,
          amount: input.amount,
          happenedAt: now,
          createdById: adminRecord.id,
          notes: input.reason?.trim() || "Admin credit adjustment from client detail.",
        },
      });
    });
  }

  if (!input.productId) {
    throw new Error("PRODUCT_REQUIRED");
  }
  const targetProductId = input.productId;

  if (input.amount < 1) {
    throw new Error("POSITIVE_AMOUNT_REQUIRED");
  }

  const entitlementRule = await prisma.entitlementRule.findFirst({
    where: {
      productId: targetProductId,
      isActive: true,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      entitlementType: true,
      entitlementScope: true,
    },
  });

  if (!entitlementRule) {
    throw new Error("PRODUCT_NOT_CREDIT_ELIGIBLE");
  }

  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.clientEntitlement.create({
      data: {
        clientId: clientRecord.id,
        productId: targetProductId,
        entitlementType: entitlementRule.entitlementType,
        entitlementScope: entitlementRule.entitlementScope,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: now,
        expiresAt: input.expiresAt ?? null,
        notes: "Admin-created credit entitlement.",
      },
      select: {
        id: true,
      },
    });

    await tx.creditLedgerEntry.create({
      data: {
        clientId: clientRecord.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.ADJUSTMENT,
        amount: input.amount,
        happenedAt: now,
        createdById: adminRecord.id,
        notes: input.reason?.trim() || "Admin created entitlement with starting credits.",
      },
    });
  });
}

export async function cancelAdminClientMembership(input: {
  clientId: string;
  subscriptionContractId: string;
}) {
  const now = new Date();
  const updated = await prisma.subscriptionContract.updateMany({
    where: {
      id: input.subscriptionContractId,
      clientId: input.clientId,
    },
    data: {
      status: SubscriptionStatus.CANCELLED,
      cancelAtPeriodEnd: true,
      cancelledAt: now,
      endedAt: now,
    },
  });

  if (updated.count === 0) {
    throw new Error("SUBSCRIPTION_NOT_FOUND");
  }
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  password: string;
  createdByUserId?: string;
}) {
  const passwordHash = await hash(input.password, 12);
  const { firstName, lastName } = splitName(input.name);

  return createUserFromTrustedFlow({
    firstName,
    lastName,
    email: input.email,
    passwordHash,
    role: input.role,
    createdVia: "ADMIN",
    createdByUserId: input.createdByUserId ?? null,
    createdIp: "admin-panel",
    activationStatus: input.isActive ? "ACTIVE" : "DISABLED",
    isActive: input.isActive,
    markEmailVerified: true,
  });
}

export async function updateAdminUser(
  id: string,
  input: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email: string;
    role: Role;
    isActive: boolean;
    phone?: string;
    notes?: string;
    bio?: string;
    specialties?: string[];
    certifications?: string[];
    hireDate?: Date | null;
    password?: string;
    marketingSubscriptionStatus?: MarketingSubscriptionStatus;
    marketingSegmentIds?: string[];
  },
  actor: {
    id: string;
    role: Role;
  },
) {
  const passwordHash = input.password ? await hash(input.password, 12) : undefined;
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || input.name?.trim() || "User";
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = toNullable(input.phone);
  const normalizedNotes = toNullable(input.notes);
  const normalizedBio = toNullable(input.bio);

  return prisma.$transaction(async (tx) => {
    const [existing, actorRecord] = await Promise.all([
      tx.user.findUnique({
        where: { id },
        select: {
          email: true,
          role: true,
        },
      }),
      tx.user.findUnique({
        where: { id: actor.id },
        select: {
          role: true,
        },
      }),
    ]);

    const actorRole = actorRecord?.role ?? actor.role;

    if (actorRole !== Role.ADMIN && actorRole !== Role.MASTER_ADMIN) {
      throw new Error("ADMIN_USER_NOT_FOUND");
    }

    if (!existing) {
      throw new Error("USER_NOT_FOUND");
    }

    if (existing.role === Role.MASTER_ADMIN && actorRole !== Role.MASTER_ADMIN) {
      throw new Error("MASTER_ADMIN_MANAGEMENT_FORBIDDEN");
    }

    if (actorRole === Role.ADMIN && input.role === Role.MASTER_ADMIN) {
      throw new Error("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN");
    }

    if (input.role !== Role.CLIENT && (input.marketingSubscriptionStatus || (input.marketingSegmentIds?.length ?? 0) > 0)) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }

    await tx.user.update({
      where: { id },
      data: {
        name: fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        role: input.role,
        isActive: input.isActive,
        isInactive: !input.isActive,
        activationStatus: input.isActive ? "ACTIVE" : "DISABLED",
        ...(input.role === Role.CLIENT && input.marketingSubscriptionStatus
          ? { marketingSubscriptionStatus: input.marketingSubscriptionStatus }
          : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

    if (existing && existing.email.toLowerCase() !== normalizedEmail) {
      await applyTrustedAdminEmailChange({
        userId: id,
        newEmail: normalizedEmail,
      });
    }

    if (input.role === Role.TEACHER) {
      await tx.teacherProfile.upsert({
        where: { userId: id },
        update: {
          phone: normalizedPhone,
          bio: normalizedBio,
          specialties: input.specialties ?? [],
          certifications: input.certifications ?? [],
          hireDate: input.hireDate ?? null,
        },
        create: {
          userId: id,
          phone: normalizedPhone,
          bio: normalizedBio,
          specialties: input.specialties ?? [],
          certifications: input.certifications ?? [],
          hireDate: input.hireDate ?? null,
        },
      });
    } else {
      await tx.clientProfile.upsert({
        where: { userId: id },
        update: {
          phone: normalizedPhone,
          notes: normalizedNotes,
        },
        create: {
          userId: id,
          phone: normalizedPhone,
          notes: normalizedNotes,
        },
      });

      if (input.role === Role.CLIENT && input.marketingSegmentIds) {
        const segmentIds = [...new Set(input.marketingSegmentIds.filter(Boolean))];
        const validSegments = await tx.marketingSegment.findMany({
          where: { id: { in: segmentIds } },
          select: { id: true },
        });
        const validSegmentIds = validSegments.map((segment) => segment.id);

        await tx.marketingUserSegment.deleteMany({
          where: { userId: id },
        });

        if (validSegmentIds.length > 0) {
          await tx.marketingUserSegment.createMany({
            data: validSegmentIds.map((segmentId) => ({
              userId: id,
              segmentId,
            })),
            skipDuplicates: true,
          });
        }
      }
    }

    return tx.user.findUnique({
      where: { id },
    });
  });
}

async function assertAdminActor(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });

  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }
}

export async function listAdminMarketingSegmentOptions(): Promise<AdminMarketingSegmentOption[]> {
  const segments = await prisma.marketingSegment.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  });

  return segments;
}

export async function bulkSetClientMarketingSubscriptionStatus(input: {
  actorUserId: string;
  userIds: string[];
  status: MarketingSubscriptionStatus;
}) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (userIds.length < 1) {
    throw new Error("USERS_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(tx, input.actorUserId);

    const clientCount = await tx.user.count({
      where: {
        id: { in: userIds },
        role: Role.CLIENT,
      },
    });

    if (clientCount !== userIds.length) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }

    const updated = await tx.user.updateMany({
      where: { id: { in: userIds } },
      data: { marketingSubscriptionStatus: input.status },
    });

    return updated.count;
  });
}

export async function bulkAddClientMarketingSegments(input: {
  actorUserId: string;
  userIds: string[];
  segmentIds: string[];
}) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  const segmentIds = [...new Set(input.segmentIds.filter(Boolean))];

  if (userIds.length < 1) {
    throw new Error("USERS_REQUIRED");
  }
  if (segmentIds.length < 1) {
    throw new Error("SEGMENTS_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(tx, input.actorUserId);

    const [clientCount, segments] = await Promise.all([
      tx.user.count({
        where: {
          id: { in: userIds },
          role: Role.CLIENT,
        },
      }),
      tx.marketingSegment.findMany({
        where: { id: { in: segmentIds } },
        select: { id: true },
      }),
    ]);

    if (clientCount !== userIds.length) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }
    if (segments.length !== segmentIds.length) {
      throw new Error("SEGMENTS_NOT_FOUND");
    }

    const rows = userIds.flatMap((userId) =>
      segmentIds.map((segmentId) => ({
        userId,
        segmentId,
      })),
    );

    const created = await tx.marketingUserSegment.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return created.count;
  });
}

export async function bulkRemoveClientMarketingSegments(input: {
  actorUserId: string;
  userIds: string[];
  segmentIds: string[];
}) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  const segmentIds = [...new Set(input.segmentIds.filter(Boolean))];

  if (userIds.length < 1) {
    throw new Error("USERS_REQUIRED");
  }
  if (segmentIds.length < 1) {
    throw new Error("SEGMENTS_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    await assertAdminActor(tx, input.actorUserId);

    const [clientCount, segments] = await Promise.all([
      tx.user.count({
        where: {
          id: { in: userIds },
          role: Role.CLIENT,
        },
      }),
      tx.marketingSegment.findMany({
        where: { id: { in: segmentIds } },
        select: { id: true },
      }),
    ]);

    if (clientCount !== userIds.length) {
      throw new Error("MARKETING_CLIENT_ONLY");
    }
    if (segments.length !== segmentIds.length) {
      throw new Error("SEGMENTS_NOT_FOUND");
    }

    const deleted = await tx.marketingUserSegment.deleteMany({
      where: {
        userId: { in: userIds },
        segmentId: { in: segmentIds },
      },
    });

    return deleted.count;
  });
}

export async function updateAdminTeacherImage(input: {
  userId: string;
  imagePath: string;
  adminUserId: string;
}) {
  const [teacherRecord, adminRecord] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true },
    }),
    prisma.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!teacherRecord || teacherRecord.role !== Role.TEACHER) {
    throw new Error("TEACHER_NOT_FOUND");
  }

  if (!adminRecord || (adminRecord.role !== Role.ADMIN && adminRecord.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  return prisma.user.update({
    where: { id: teacherRecord.id },
    data: {
      image: input.imagePath.trim(),
    },
    select: {
      id: true,
      image: true,
    },
  });
}

export async function updateAdminClassImage(input: {
  classTypeId: string;
  imagePath: string;
  adminUserId: string;
}) {
  const [classType, adminRecord] = await prisma.$transaction([
    prisma.classType.findUnique({
      where: { id: input.classTypeId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: input.adminUserId },
      select: { id: true, role: true },
    }),
  ]);

  if (!classType) {
    throw new Error("CLASS_NOT_FOUND");
  }

  if (!adminRecord || (adminRecord.role !== Role.ADMIN && adminRecord.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_USER_NOT_FOUND");
  }

  return prisma.classType.update({
    where: { id: classType.id },
    data: {
      imageUrl: input.imagePath.trim(),
    },
    select: {
      id: true,
      imageUrl: true,
    },
  });
}

export async function getAdminSubscriptionsData(): Promise<AdminSubscriptionItem[]> {
  const result = await getAdminSubscriptionsPageData({ page: 1, pageSize: 150 });
  return result.items;
}

export async function getAdminOrdersPageData(input: {
  page: number;
  pageSize?: number;
  filter: AdminOrderDateFilter;
  query?: string;
}): Promise<AdminOrdersPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const now = new Date();
  const start = getAdminOrderFilterStart(input.filter, now);
  const query = input.query?.trim() ?? "";
  const skip = (page - 1) * pageSize;

  const where: Prisma.OrderItemWhereInput = {
    order: {
      status: OrderStatus.PAID,
      ...(start ? { placedAt: { gte: start } } : {}),
    },
    ...(query
      ? {
          OR: [
            {
              productNameSnapshot: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              priceNameSnapshot: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              order: {
                id: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              order: {
                client: {
                  name: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              },
            },
            {
              order: {
                client: {
                  email: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [totalItems, rows] = await prisma.$transaction([
    prisma.orderItem.count({ where }),
    prisma.orderItem.findMany({
      where,
      orderBy: [{ order: { placedAt: "desc" } }, { createdAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        quantity: true,
        productNameSnapshot: true,
        priceNameSnapshot: true,
        lineTotalAmountMinor: true,
        currencyCode: true,
        order: {
          select: {
            id: true,
            placedAt: true,
            client: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    filter: input.filter,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    items: rows.map((row) => ({
      id: row.id,
      orderId: row.order.id,
      purchasedAt: row.order.placedAt.toISOString(),
      clientName: row.order.client.name,
      clientEmail: row.order.client.email,
      productName: row.productNameSnapshot,
      priceName: row.priceNameSnapshot,
      quantity: row.quantity,
      lineTotalAmountMinor: row.lineTotalAmountMinor,
      currencyCode: row.currencyCode,
    })),
  };
}

export async function getAdminSubscriptionsPageData(input: {
  page: number;
  pageSize?: number;
  filter?: AdminSubscriptionStatusFilter;
  query?: string;
}): Promise<AdminSubscriptionsPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const query = input.query?.trim() ?? "";
  const skip = (page - 1) * pageSize;
  const status = getAdminSubscriptionStatus(input.filter ?? "all");

  const where: Prisma.SubscriptionContractWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            {
              client: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              client: {
                email: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              product: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
            {
              price: {
                name: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
          ],
        }
      : {}),
  };

  const [totalItems, rows] = await prisma.$transaction([
    prisma.subscriptionContract.count({ where }),
    prisma.subscriptionContract.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        startsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelledAt: true,
        endedAt: true,
        provider: true,
        client: {
          select: {
            name: true,
            email: true,
          },
        },
        product: {
          select: {
            name: true,
          },
        },
        price: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    items: rows.map((row) => ({
      id: row.id,
      clientName: row.client.name,
      clientEmail: row.client.email,
      productName: row.product.name,
      priceName: row.price.name,
      status: row.status,
      startsAt: row.startsAt.toISOString(),
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      provider: row.provider,
    })),
  };
}

export async function getAdminSubscriptionById(id: string) {
  return prisma.subscriptionContract.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      productId: true,
      priceId: true,
      status: true,
      startsAt: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      cancelledAt: true,
      endedAt: true,
      provider: true,
      providerSubscriptionReference: true,
    },
  });
}

export async function getAdminSubscriptionOptions() {
  const [clients, products, prices] = await prisma.$transaction([
    prisma.user.findMany({
      where: { role: Role.CLIENT },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.product.findMany({
      where: { isArchived: false, isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.price.findMany({
      where: { isArchived: false, isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, productId: true },
    }),
  ]);

  return { clients, products, prices };
}

export async function createAdminSubscription(input: {
  clientId: string;
  productId: string;
  priceId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  provider: PaymentProvider;
  providerSubscriptionReference?: string;
}) {
  const price = await prisma.price.findUnique({
    where: { id: input.priceId },
    select: { productId: true },
  });

  if (!price || price.productId !== input.productId) {
    throw new Error("PRICE_PRODUCT_MISMATCH");
  }

  return prisma.subscriptionContract.create({
    data: {
      clientId: input.clientId,
      productId: input.productId,
      priceId: input.priceId,
      status: input.status,
      startsAt: input.startsAt,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      provider: input.provider,
      providerSubscriptionReference: toNullable(input.providerSubscriptionReference),
    },
  });
}

export async function updateAdminSubscription(
  id: string,
  input: {
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    cancelledAt?: Date | null;
    endedAt?: Date | null;
    providerSubscriptionReference?: string;
  },
) {
  return prisma.subscriptionContract.update({
    where: { id },
    data: {
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      cancelledAt: input.cancelledAt ?? null,
      endedAt: input.endedAt ?? null,
      providerSubscriptionReference: toNullable(input.providerSubscriptionReference),
    },
  });
}

export async function getAdminLearningProgramsData(): Promise<AdminLearningProgramItem[]> {
  const programs = await prisma.learningProgram.findMany({
    orderBy: [{ title: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      courseType: true,
      mainTitle: true,
      title: true,
      updatedAt: true,
    },
  });

  return programs.map((item) => ({
    ...item,
    updatedAt: item.updatedAt.toISOString(),
  }));
}

export async function getAdminLearningProgramById(id: string) {
  return prisma.learningProgram.findUnique({
    where: { id },
    select: {
      id: true,
      legacyId: true,
      mainTitle: true,
      mainDescription: true,
      courseType: true,
      title: true,
      description1: true,
      description2: true,
      description3: true,
      videoPromo: true,
      picture1: true,
      picture2: true,
      picture3: true,
    },
  });
}

export async function createAdminLearningProgram(input: {
  legacyId?: string;
  mainTitle: string;
  mainDescription?: string;
  courseType: string;
  title: string;
  description1?: string;
  description2?: string;
  description3?: string;
  videoPromo?: string;
  picture1?: string;
  picture2?: string;
  picture3?: string;
}) {
  const normalizedLegacyId = input.legacyId?.trim() || `program-${randomUUID().replace(/-/g, "")}`;
  return prisma.learningProgram.create({
    data: {
      legacyId: normalizedLegacyId,
      mainTitle: input.mainTitle.trim(),
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      title: input.title.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: assertLearningImagePath(input.picture1, "picture1"),
      picture2: assertLearningImagePath(input.picture2, "picture2"),
      picture3: assertLearningImagePath(input.picture3, "picture3"),
    },
  });
}

export async function updateAdminLearningProgram(
  id: string,
  input: {
    legacyId?: string;
    mainTitle: string;
    mainDescription?: string;
    courseType: string;
    title: string;
    description1?: string;
    description2?: string;
    description3?: string;
    videoPromo?: string;
    picture1?: string;
    picture2?: string;
    picture3?: string;
  },
) {
  const normalizedLegacyId = input.legacyId?.trim();
  return prisma.learningProgram.update({
    where: { id },
    data: {
      ...(normalizedLegacyId ? { legacyId: normalizedLegacyId } : {}),
      mainTitle: input.mainTitle.trim(),
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      title: input.title.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: assertLearningImagePath(input.picture1, "picture1"),
      picture2: assertLearningImagePath(input.picture2, "picture2"),
      picture3: assertLearningImagePath(input.picture3, "picture3"),
    },
  });
}

export async function getAdminLearningVideosData(): Promise<AdminLearningVideoItem[]> {
  const videos = await prisma.learningCourse.findMany({
    orderBy: [{ priority: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      category: true,
      categoryType: true,
      categoryLevel: true,
      priority: true,
      updatedAt: true,
    },
  });

  return videos.map((item) => ({
    ...item,
    updatedAt: item.updatedAt.toISOString(),
  }));
}

export async function getAdminOnlineLearningData(): Promise<{
  programs: AdminLearningProgramItem[];
  videos: AdminLearningVideoItem[];
}> {
  const [programs, videos] = await Promise.all([
    getAdminLearningProgramsData(),
    getAdminLearningVideosData(),
  ]);
  return { programs, videos };
}

export async function getAdminLearningVideoById(id: string) {
  return prisma.learningCourse.findUnique({
    where: { id },
    select: {
      id: true,
      legacyId: true,
      title: true,
      description: true,
      shortDescription: true,
      category: true,
      categoryType: true,
      categoryLevel: true,
      thumbnail: true,
      videoUrl: true,
      priority: true,
    },
  });
}

export async function createAdminLearningVideo(input: {
  legacyId?: string;
  title: string;
  description?: string;
  shortDescription?: string;
  category: string;
  categoryType?: string;
  categoryLevel?: string;
  thumbnail?: string;
  videoUrl?: string;
  priority: number;
}) {
  const normalizedLegacyId = input.legacyId?.trim() || `course-${randomUUID().replace(/-/g, "")}`;
  return prisma.learningCourse.create({
    data: {
      legacyId: normalizedLegacyId,
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      categoryType: toNullable(input.categoryType),
      categoryLevel: toNullable(input.categoryLevel),
      thumbnail: assertLearningImagePath(input.thumbnail, "thumbnail"),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}

export async function updateAdminLearningVideo(
  id: string,
  input: {
    legacyId?: string;
    title: string;
    description?: string;
    shortDescription?: string;
    category: string;
    categoryType?: string;
    categoryLevel?: string;
    thumbnail?: string;
    videoUrl?: string;
    priority: number;
  },
) {
  const normalizedLegacyId = input.legacyId?.trim();
  return prisma.learningCourse.update({
    where: { id },
    data: {
      ...(normalizedLegacyId ? { legacyId: normalizedLegacyId } : {}),
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      categoryType: toNullable(input.categoryType),
      categoryLevel: toNullable(input.categoryLevel),
      thumbnail: assertLearningImagePath(input.thumbnail, "thumbnail"),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}






















