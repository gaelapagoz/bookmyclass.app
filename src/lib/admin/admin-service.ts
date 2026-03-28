import {
  BillingInterval,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementType,
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
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { generatePlanSlug } from "@/lib/admin/plan-slug";
import { ensureEntitlementRuleForProduct } from "@/lib/admin/plan-entitlement-rules";
import { provisionPlanOnStripe, resolveStripeProductIdFromPrice } from "@/lib/admin/plan-provisioning";

export type AdminDashboardData = {
  diagnostics: Array<{
    key: "week" | "month" | "quarter";
    label: string;
    siteSessions: number;
    totalOrders: number;
    totalBookings: number;
    totalCancellations: number;
    totalSalesByCurrency: Array<{
      currencyCode: string;
      amountMinor: number;
    }>;
  }>;
  upcomingSessions: Array<{
    id: string;
    title: string;
    startsAt: string;
    bookedSpots: number;
    capacity: number;
  }>;
};

export type AdminClassItem = {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  defaultDurationMinutes: number;
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
  repeatEveryWeeks: number;
  weekdays: Weekday[];
  endsType: "never" | "onDate" | "afterOccurrences";
  endDate: string | null;
  occurrenceCount: number | null;
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

export type AdminUserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminUserDetail = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  isActive: boolean;
  phone: string;
  notes: string;
  bio: string;
  specialties: string[];
  certifications: string[];
  hireDate: string | null;
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

export type AdminLearningProgramItem = {
  id: string;
  legacyId: string;
  courseType: string;
  mainTitle: string;
  title: string;
  updatedAt: string;
};

export type AdminLearningVideoItem = {
  id: string;
  legacyId: string;
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

function getCurrentWeekRange(now: Date): DateRange {
  const dayOfWeek = now.getDay();
  const diffToMonday = (dayOfWeek + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return { start, end };
}

function getCurrentMonthRange(now: Date): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

function getCurrentQuarterRange(now: Date): DateRange {
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const start = new Date(now.getFullYear(), quarterStartMonth, 1);
  const end = new Date(now.getFullYear(), quarterStartMonth + 3, 1);
  return { start, end };
}

async function getPeriodDiagnostics(input: {
  key: "week" | "month" | "quarter";
  label: string;
  range: DateRange;
}) {
  const [siteSessions, totalOrders, totalBookings, totalCancellations, totalSalesByCurrency] =
    await prisma.$transaction([
      prisma.session.count({
        where: {
          createdAt: {
            gte: input.range.start,
            lt: input.range.end,
          },
        },
      }),
      prisma.order.count({
        where: {
          status: OrderStatus.PAID,
          placedAt: {
            gte: input.range.start,
            lt: input.range.end,
          },
        },
      }),
      prisma.booking.count({
        where: {
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
          },
          bookedAt: {
            gte: input.range.start,
            lt: input.range.end,
          },
        },
      }),
      prisma.booking.count({
        where: {
          status: BookingStatus.CANCELLED,
          cancelledAt: {
            gte: input.range.start,
            lt: input.range.end,
          },
        },
      }),
      prisma.payment.groupBy({
        by: ["currencyCode"],
        where: {
          status: PaymentStatus.SUCCEEDED,
          createdAt: {
            gte: input.range.start,
            lt: input.range.end,
          },
        },
        _sum: {
          amountMinor: true,
        },
      }),
    ]);

  return {
    key: input.key,
    label: input.label,
    siteSessions,
    totalOrders,
    totalBookings,
    totalCancellations,
    totalSalesByCurrency: totalSalesByCurrency.map((entry) => ({
      currencyCode: entry.currencyCode,
      amountMinor: entry._sum.amountMinor ?? 0,
    })),
  };
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const now = new Date();
  const [diagnostics, upcomingSessions] = await Promise.all([
    Promise.all([
      getPeriodDiagnostics({
        key: "week",
        label: "Current Week",
        range: getCurrentWeekRange(now),
      }),
      getPeriodDiagnostics({
        key: "month",
        label: "Current Month",
        range: getCurrentMonthRange(now),
      }),
      getPeriodDiagnostics({
        key: "quarter",
        label: "Current Quarter",
        range: getCurrentQuarterRange(now),
      }),
    ]),
    prisma.studioSession.findMany({
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
              in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
            },
          },
          select: {
            id: true,
          },
        },
      },
    }),
  ]);

  return {
    diagnostics,
    upcomingSessions: upcomingSessions.map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt.toISOString(),
      bookedSpots: session.bookings.length,
      capacity: session.capacity,
    })),
  };
}

export async function getAdminClassesData(): Promise<AdminClassItem[]> {
  const classes = await prisma.classType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      defaultDurationMinutes: true,
      defaultCapacity: true,
      isActive: true,
      isVisible: true,
      sortOrder: true,
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
    slug: item.slug,
    categoryName: item.category.name,
    defaultDurationMinutes: item.defaultDurationMinutes,
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
  const defaultDate = nextSession?.startsAt.toISOString().slice(0, 10) ?? null;

  const schedule: AdminClassScheduleConfig = {
    defaultTeacherId: template?.defaultTeacherId ?? "",
    startTime,
    endTime,
    isRecurring,
    date: defaultDate,
    repeatEveryWeeks: 1,
    weekdays: recurringRules.map((rule) => rule.weekday),
    endsType: recurringRules[0]?.endDate ? "onDate" : "never",
    endDate: recurringRules[0]?.endDate?.toISOString().slice(0, 10) ?? null,
    occurrenceCount: null,
  };

  return {
    id: classType.id,
    categoryId: classType.categoryId,
    name: classType.name,
    slug: classType.slug,
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

export async function createAdminClass(input: {
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  isActive: boolean;
  isVisible: boolean;
  sortOrder: number;
}) {
  return prisma.classType.create({
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug: input.slug.trim(),
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
    slug: string;
    description?: string;
    defaultDurationMinutes: number;
    defaultCapacity: number;
    isActive: boolean;
    isVisible: boolean;
    sortOrder: number;
  },
) {
  return prisma.classType.update({
    where: { id },
    data: {
      categoryId: input.categoryId,
      name: input.name.trim(),
      slug: input.slug.trim(),
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
  classSlug: string;
  defaultCapacity: number;
  defaultDurationMinutes: number;
  defaultTeacherId: string;
  startTime: string;
  endTime: string;
  isRecurring: boolean;
  date?: Date | null;
  repeatEveryWeeks?: number;
  weekdays?: Weekday[];
  endsType?: "never" | "onDate" | "afterOccurrences";
  endDate?: Date | null;
  occurrenceCount?: number | null;
}) {
  if (!input.defaultTeacherId) {
    throw new Error("TEACHER_REQUIRED");
  }

  const durationMinutes = validateTimeRange(input.startTime, input.endTime);
  const repeatEveryWeeks = input.repeatEveryWeeks ?? 1;
  const weekdays = input.weekdays ?? [];
  const endsType = input.endsType ?? "never";
  const now = new Date();

  if (input.isRecurring && weekdays.length < 1) {
    throw new Error("INVALID_RECURRENCE_WEEKDAYS");
  }
  if (input.isRecurring && endsType === "onDate" && !input.endDate) {
    throw new Error("RECURRENCE_END_DATE_REQUIRED");
  }
  if (input.isRecurring && endsType === "afterOccurrences" && (!input.occurrenceCount || input.occurrenceCount < 1)) {
    throw new Error("RECURRENCE_OCCURRENCES_REQUIRED");
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
              slug: `${input.classSlug}-schedule-${Date.now()}`,
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
      const startsOn = input.date ?? now;
      const schedule = {
        startsOn,
        startTime: input.startTime,
        endTime: input.endTime,
        repeatEveryWeeks,
        weekdays,
        endMode:
          endsType === "onDate"
            ? ("on_date" as const)
            : endsType === "afterOccurrences"
              ? ("after_occurrences" as const)
              : ("never" as const),
        endDate: input.endDate ?? null,
        occurrences: input.occurrenceCount ?? undefined,
      };

      const occurrences = buildRecurringOccurrences(schedule);
      const endDateForRule =
        endsType === "onDate"
          ? input.endDate ?? null
          : endsType === "afterOccurrences"
            ? (occurrences[occurrences.length - 1]?.startsAt ?? null)
            : null;

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
}): Promise<AdminSessionItem[]> {
  const sessions = await prisma.studioSession.findMany({
    where:
      input?.weekStart && input.weekEnd
        ? {
            startsAt: {
              gte: input.weekStart,
              lt: input.weekEnd,
            },
          }
        : undefined,
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

export async function getAdminSessionById(id: string) {
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
    },
  });
}

export async function getAdminSessionOptions() {
  const [templates, teachers] = await prisma.$transaction([
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
  ]);

  return { templates, teachers };
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

export async function getAdminBookingsData(): Promise<AdminBookingItem[]> {
  const bookings = await prisma.booking.findMany({
    orderBy: [{ bookedAt: "desc" }],
    take: 100,
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
  });

  return bookings.map((item) => ({
    id: item.id,
    status: item.status,
    paymentSelection: item.paymentSelection,
    bookedAt: item.bookedAt.toISOString(),
    customerName: item.customerName ?? item.client?.name ?? "Guest",
    customerEmail: item.customerEmail ?? item.client?.email ?? "-",
    sessionTitle: item.studioSession.title,
    startsAt: item.studioSession.startsAt.toISOString(),
  }));
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
    },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }));
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
    phone: primaryPhone,
    notes: user.clientProfile?.notes ?? "",
    bio: user.teacherProfile?.bio ?? "",
    specialties: user.teacherProfile?.specialties ?? [],
    certifications: user.teacherProfile?.certifications ?? [],
    hireDate: user.teacherProfile?.hireDate?.toISOString() ?? null,
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
          notes: "Admin credit adjustment from client detail.",
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
        notes: "Admin created entitlement with starting credits.",
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
}) {
  const passwordHash = await hash(input.password, 12);

  return prisma.user.create({
    data: {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      isActive: input.isActive,
      isInactive: !input.isActive,
      passwordHash,
    },
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
  },
) {
  const passwordHash = input.password ? await hash(input.password, 12) : undefined;
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || input.name?.trim() || "User";
  const normalizedPhone = toNullable(input.phone);
  const normalizedNotes = toNullable(input.notes);
  const normalizedBio = toNullable(input.bio);

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        name: fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        isActive: input.isActive,
        isInactive: !input.isActive,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

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
    }

    return tx.user.findUnique({
      where: { id },
    });
  });
}

export async function getAdminSubscriptionsData(): Promise<AdminSubscriptionItem[]> {
  const rows = await prisma.subscriptionContract.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 150,
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
  });

  return rows.map((row) => ({
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
  }));
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
    orderBy: [{ legacyId: "asc" }],
    select: {
      id: true,
      legacyId: true,
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
  legacyId: string;
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
  return prisma.learningProgram.create({
    data: {
      legacyId: input.legacyId.trim(),
      mainTitle: input.mainTitle.trim(),
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      title: input.title.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: toNullable(input.picture1),
      picture2: toNullable(input.picture2),
      picture3: toNullable(input.picture3),
    },
  });
}

export async function updateAdminLearningProgram(
  id: string,
  input: {
    legacyId: string;
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
  return prisma.learningProgram.update({
    where: { id },
    data: {
      legacyId: input.legacyId.trim(),
      mainTitle: input.mainTitle.trim(),
      mainDescription: toNullable(input.mainDescription),
      courseType: input.courseType.trim(),
      title: input.title.trim(),
      description1: toNullable(input.description1),
      description2: toNullable(input.description2),
      description3: toNullable(input.description3),
      videoPromo: toNullable(input.videoPromo),
      picture1: toNullable(input.picture1),
      picture2: toNullable(input.picture2),
      picture3: toNullable(input.picture3),
    },
  });
}

export async function getAdminLearningVideosData(): Promise<AdminLearningVideoItem[]> {
  const videos = await prisma.learningCourse.findMany({
    orderBy: [{ priority: "asc" }, { title: "asc" }],
    select: {
      id: true,
      legacyId: true,
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
  legacyId: string;
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
  return prisma.learningCourse.create({
    data: {
      legacyId: input.legacyId.trim(),
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      categoryType: toNullable(input.categoryType),
      categoryLevel: toNullable(input.categoryLevel),
      thumbnail: toNullable(input.thumbnail),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}

export async function updateAdminLearningVideo(
  id: string,
  input: {
    legacyId: string;
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
  return prisma.learningCourse.update({
    where: { id },
    data: {
      legacyId: input.legacyId.trim(),
      title: input.title.trim(),
      description: toNullable(input.description),
      shortDescription: toNullable(input.shortDescription),
      category: input.category.trim(),
      categoryType: toNullable(input.categoryType),
      categoryLevel: toNullable(input.categoryLevel),
      thumbnail: toNullable(input.thumbnail),
      videoUrl: toNullable(input.videoUrl),
      priority: input.priority,
    },
  });
}
















