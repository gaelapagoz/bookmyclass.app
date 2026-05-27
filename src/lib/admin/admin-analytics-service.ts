import { BookingStatus, OrderStatus, PaymentStatus, StudioSessionStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

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

type AdminPeriodRanges = {
  currentStart: Date;
  currentEnd: Date;
};

type RollingPeriodRanges = {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
  todayStart: Date;
  yesterdayStart: Date;
};

type DateRange = { start: Date; end: Date };

const VALID_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
];

function addDays(input: Date, amount: number): Date {
  const date = new Date(input);
  date.setDate(date.getDate() + amount);
  return date;
}

function getPeriodDuration(period: AdminPeriod): number {
  if (period === "last7Days") {
    return 7;
  }
  if (period === "last30Days") {
    return 30;
  }
  return 90;
}

function getRollingPeriodRange(period: AdminPeriod, now: Date): AdminPeriodRanges {
  const currentEnd = new Date(now);
  currentEnd.setHours(0, 0, 0, 0);
  currentEnd.setDate(currentEnd.getDate() + 1);
  const durationDays = getPeriodDuration(period);
  const currentStart = addDays(currentEnd, -durationDays);
  return { currentStart, currentEnd };
}

function getOperationalRollingPeriodRange(period: AdminPeriod, now: Date): RollingPeriodRanges {
  const durationDays = getPeriodDuration(period);
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
    buckets.set(key, { date: key, sessions: 0, sales: 0, orders: 0, bookings: 0, cancellations: 0 });
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
  if (previousTotal === 0 && total === 0) return { deltaPercentage: 0, trendDirection: "flat" as const };
  if (previousTotal === 0 && total > 0) return { deltaPercentage: null, trendDirection: "up" as const };
  const rawDelta = ((total - previousTotal) / previousTotal) * 100;
  const deltaPercentage = Number(rawDelta.toFixed(1));
  if (deltaPercentage > 0) return { deltaPercentage, trendDirection: "up" as const };
  if (deltaPercentage < 0) return { deltaPercentage, trendDirection: "down" as const };
  return { deltaPercentage, trendDirection: "flat" as const };
}

export async function getOperationalMetricCards(period: AdminPeriod): Promise<AdminMetricCard[]> {
  const now = new Date();
  const ranges = getOperationalRollingPeriodRange(period, now);
  const todayEnd = addDays(ranges.todayStart, 1);

  const metricDefinitions: MetricDefinition[] = [
    {
      key: "siteSessions",
      label: "Site Sessions",
      format: "number",
      getValue: (range) => prisma.session.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
    },
    {
      key: "totalSales",
      label: "Total Sales",
      format: "currency",
      getValue: async (range) => {
        const result = await prisma.payment.aggregate({
          _sum: { amountMinor: true },
          where: { status: PaymentStatus.SUCCEEDED, createdAt: { gte: range.start, lt: range.end } },
        });
        return result._sum.amountMinor ?? 0;
      },
    },
    {
      key: "totalOrders",
      label: "Total Orders",
      format: "number",
      getValue: (range) => prisma.order.count({ where: { status: OrderStatus.PAID, placedAt: { gte: range.start, lt: range.end } } }),
    },
    {
      key: "bookings",
      label: "Total Bookings",
      format: "number",
      getValue: (range) => prisma.booking.count({ where: { status: { in: VALID_BOOKING_STATUSES }, bookedAt: { gte: range.start, lt: range.end } } }),
    },
    {
      key: "cancellations",
      label: "Total Cancellations",
      format: "number",
      getValue: (range) => prisma.booking.count({ where: { status: BookingStatus.CANCELLED, cancelledAt: { gte: range.start, lt: range.end } } }),
    },
  ];

  return Promise.all(
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
}

export async function getDashboardTrendData(period: AdminPeriod): Promise<DashboardTrendPoint[]> {
  const now = new Date();
  const days = getPeriodDuration(period);
  const totalDays = 100;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const start = addDays(todayStart, -(totalDays - 1));
  const end = addDays(todayStart, 1);

  const [sessions, sales, orders, bookings, cancellations] = await Promise.all([
    prisma.session.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { createdAt: true } }),
    prisma.payment.findMany({ where: { status: PaymentStatus.SUCCEEDED, createdAt: { gte: start, lt: end } }, select: { createdAt: true, amountMinor: true } }),
    prisma.order.findMany({ where: { status: OrderStatus.PAID, placedAt: { gte: start, lt: end } }, select: { placedAt: true } }),
    prisma.booking.findMany({ where: { status: { in: VALID_BOOKING_STATUSES }, bookedAt: { gte: start, lt: end } }, select: { bookedAt: true } }),
    prisma.booking.findMany({ where: { status: BookingStatus.CANCELLED, cancelledAt: { gte: start, lt: end } }, select: { cancelledAt: true } }),
  ]);

  const buckets = buildTrendBase(now, totalDays);
  for (const row of sessions) {
    const bucket = buckets.get(toDayKey(row.createdAt));
    if (bucket) bucket.sessions += 1;
  }
  for (const row of sales) {
    const bucket = buckets.get(toDayKey(row.createdAt));
    if (bucket) bucket.sales += row.amountMinor;
  }
  for (const row of orders) {
    const bucket = buckets.get(toDayKey(row.placedAt));
    if (bucket) bucket.orders += 1;
  }
  for (const row of bookings) {
    const bucket = buckets.get(toDayKey(row.bookedAt));
    if (bucket) bucket.bookings += 1;
  }
  for (const row of cancellations) {
    if (!row.cancelledAt) continue;
    const bucket = buckets.get(toDayKey(row.cancelledAt));
    if (bucket) bucket.cancellations += 1;
  }

  return [...buckets.values()].slice(-days);
}

export async function getAdminDashboardInsights(period: AdminPeriod): Promise<AdminDashboardInsights> {
  const periodRange = getRollingPeriodRange(period, new Date());

  const bookingsInWindow = await prisma.booking.findMany({
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
  });

  const bookingsBeforeWindow = await prisma.booking.findMany({
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
  });

  const staffSessionsInWindow = await prisma.studioSession.findMany({
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
  });

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
