import {
  AttendanceSource,
  AttendanceStatus,
  BookingStatus,
  ClientEntitlementStatus,
  EntitlementScope,
  EntitlementType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  WaitlistStatus,
  Weekday,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { resolveEntitlementScope } from "@/lib/booking/entitlement-scope";
import { bookingDraftActiveBookingFilter } from "@/lib/public-booking/booking-draft-service";

export type AdminSessionItem = {
  id: string;
  title: string;
  className: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
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
  manualOverrideLabel: string | null;
};

export type AdminSessionWaitlistItem = {
  waitlistEntryId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  joinedAt: string;
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
  waitlistEntries: AdminSessionWaitlistItem[];
};

export type AdminSessionClientOption = {
  id: string;
  name: string;
  email: string;
  availableCredits: number;
  hasAvailableCredits: boolean;
  hasEligibleAccess: boolean;
  eligibilityLabel: string;
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

const MANUAL_OVERRIDE_LABEL = "Manual override — no credit used";
const MANUAL_OVERRIDE_AUDIT_ACTION = "BOOKING_ADMIN_OVERRIDE_CREATE";
function toNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTimeToMinutes(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);
  if (
    Number.isNaN(hours)
    || Number.isNaN(minutes)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
  ) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}

function getWeekdayIndex(weekday: Weekday): number {
  switch (weekday) {
    case Weekday.SUNDAY:
      return 0;
    case Weekday.MONDAY:
      return 1;
    case Weekday.TUESDAY:
      return 2;
    case Weekday.WEDNESDAY:
      return 3;
    case Weekday.THURSDAY:
      return 4;
    case Weekday.FRIDAY:
      return 5;
    case Weekday.SATURDAY:
      return 6;
    default:
      return 0;
  }
}

function buildRecurringOccurrences(input: AdminRecurringSessionScheduleInput): Array<{
  weekday: Weekday;
  startsAt: Date;
  endsAt: Date;
}> {
  const startMinutes = parseTimeToMinutes(input.startTime);
  const endMinutes = parseTimeToMinutes(input.endTime);
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes) || endMinutes <= startMinutes) {
    return [];
  }

  const durationMinutes = endMinutes - startMinutes;
  const startDate = new Date(input.startsOn);
  startDate.setHours(0, 0, 0, 0);

  const endDate = input.endDate ? new Date(input.endDate) : null;
  if (endDate) {
    endDate.setHours(23, 59, 59, 999);
  }

  const weekdays = [...new Set(input.weekdays)].sort(
    (left, right) => getWeekdayIndex(left) - getWeekdayIndex(right),
  );
  if (weekdays.length === 0) {
    return [];
  }

  const occurrences: Array<{ weekday: Weekday; startsAt: Date; endsAt: Date }> = [];
  const occurrenceLimit = input.endMode === "after_occurrences" ? input.occurrences ?? 0 : 1000;
  const maxIterations = 10000;

  const current = new Date(startDate);
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;

    if (input.endMode === "after_occurrences" && occurrences.length >= occurrenceLimit) {
      break;
    }

    if (input.endMode === "on_date" && endDate && current > endDate) {
      break;
    }

    const weekOffset = Math.floor((current.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const alignsWithInterval = weekOffset % input.repeatEveryWeeks === 0;

    if (alignsWithInterval) {
      const currentWeekday = current.getDay();
      for (const weekday of weekdays) {
        if (getWeekdayIndex(weekday) !== currentWeekday) {
          continue;
        }

        const startsAt = new Date(current);
        startsAt.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

        if (startsAt < input.startsOn) {
          continue;
        }

        if (input.endMode === "on_date" && endDate && startsAt > endDate) {
          continue;
        }

        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
        occurrences.push({ weekday, startsAt, endsAt });

        if (input.endMode === "after_occurrences" && occurrences.length >= occurrenceLimit) {
          break;
        }
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return occurrences.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
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
      const startsAt = combineDateAndTime(cursor, input.startTime);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
      results.push({ weekday, startsAt, endsAt });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return results;
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
      clientId: { in: input.clientIds },
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

  const entitlementIds = entitlements.map((entitlement) => entitlement.id);
  const balances = await prisma.creditLedgerEntry.groupBy({
    by: ["entitlementId"],
    where: {
      clientId: { in: input.clientIds },
      entitlementId: { in: entitlementIds },
    },
    _sum: { amount: true },
  });

  const balanceByEntitlementId = new Map(
    balances
      .filter((balance): balance is typeof balance & { entitlementId: string } => Boolean(balance.entitlementId))
      .map((balance) => [balance.entitlementId, balance._sum.amount ?? 0]),
  );

  const creditsByClientId = new Map<string, number>();
  for (const entitlement of entitlements) {
    const current = creditsByClientId.get(entitlement.clientId) ?? 0;
    const balance = Math.max(0, balanceByEntitlementId.get(entitlement.id) ?? 0);
    creditsByClientId.set(entitlement.clientId, current + balance);
  }

  return creditsByClientId;
}

async function getClientEligibleAccessByScope(input: {
  clientIds: string[];
  requiredScope: EntitlementScope;
}): Promise<Map<string, { hasEligibleAccess: boolean; eligibilityLabel: string }>> {
  if (input.clientIds.length === 0) {
    return new Map();
  }

  const now = new Date();
  const result = new Map<string, { hasEligibleAccess: boolean; eligibilityLabel: string }>();

  const activeSubscriptions = await prisma.subscriptionContract.findMany({
    where: {
      clientId: { in: input.clientIds },
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: { lte: now },
      currentPeriodEnd: { gt: now },
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      product: {
        entitlementRules: {
          some: {
            isActive: true,
            entitlementType: EntitlementType.UNLIMITED_ACCESS,
            entitlementScope: { in: [input.requiredScope, EntitlementScope.ALL_CLASSES] },
          },
        },
      },
    },
    select: { clientId: true },
  });
  for (const subscription of activeSubscriptions) {
    result.set(subscription.clientId, {
      hasEligibleAccess: true,
      eligibilityLabel: "Unlimited access available",
    });
  }

  const unlimitedEntitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId: { in: input.clientIds },
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: { in: [input.requiredScope, EntitlementScope.ALL_CLASSES] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { clientId: true },
  });
  for (const entitlement of unlimitedEntitlements) {
    if (!result.has(entitlement.clientId)) {
      result.set(entitlement.clientId, {
        hasEligibleAccess: true,
        eligibilityLabel: "Unlimited access available",
      });
    }
  }

  const availableCreditsByClientId = await getClientAvailableCreditsByScope({
    clientIds: input.clientIds,
    requiredScope: input.requiredScope,
  });
  for (const clientId of input.clientIds) {
    if (result.has(clientId)) {
      continue;
    }
    const availableCredits = availableCreditsByClientId.get(clientId) ?? 0;
    if (availableCredits > 0) {
      result.set(clientId, {
        hasEligibleAccess: true,
        eligibilityLabel: `${availableCredits} credits available`,
      });
      continue;
    }
    result.set(clientId, {
      hasEligibleAccess: false,
      eligibilityLabel: "No eligible credit or subscription",
    });
  }

  return result;
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
    },
  });

  const items: AdminSessionItem[] = [];
  for (const session of sessions) {
    const [bookedCount, waitlistCount] = await Promise.all([
      prisma.booking.count({
        where: {
          studioSessionId: session.id,
          ...bookingDraftActiveBookingFilter(),
        },
      }),
      prisma.waitlistEntry.count({
        where: {
          studioSessionId: session.id,
          status: WaitlistStatus.ACTIVE,
        },
      }),
    ]);

    items.push({
      id: session.id,
      title: session.title,
      className: session.classType.name,
      teacherName: session.teacher.name,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      location: session.location,
      capacity: session.capacity,
      bookedCount,
      waitlistCount,
      status: session.status,
      isPublished: session.isPublished,
    });
  }

  return items;
}

export async function getAdminSessionById(id: string): Promise<AdminSessionDetail | null> {
  const session = await prisma.studioSession.findUnique({
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
      waitlistEntries: {
        where: {
          status: WaitlistStatus.ACTIVE,
        },
        orderBy: [{ joinedAt: "asc" }],
        select: {
          id: true,
          clientId: true,
          joinedAt: true,
          client: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const bookingIds = session.bookings.map((booking) => booking.id);
  const overrideAuditLogs = bookingIds.length > 0
    ? await prisma.auditLog.findMany({
        where: {
          actionType: MANUAL_OVERRIDE_AUDIT_ACTION,
          entityType: "Booking",
          entityId: {
            in: bookingIds,
          },
        },
        select: {
          entityId: true,
        },
      })
    : [];
  const manualOverrideBookingIds = new Set(
    overrideAuditLogs.flatMap((log) => (log.entityId ? [log.entityId] : [])),
  );

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
      manualOverrideLabel: manualOverrideBookingIds.has(booking.id) ? MANUAL_OVERRIDE_LABEL : null,
    })),
    waitlistEntries: session.waitlistEntries.map((entry) => ({
      waitlistEntryId: entry.id,
      clientId: entry.clientId,
      clientName: entry.client.name,
      clientEmail: entry.client.email,
      joinedAt: entry.joinedAt.toISOString(),
    })),
  };
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
        hasEligibleAccess: false,
        eligibilityLabel: "No eligible credit or subscription",
      })),
    };
  }

  const sessionClassCategory = await prisma.studioSession.findUnique({
    where: { id: sessionId },
    select: {
      classType: {
        select: {
          serviceScope: true,
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
        hasEligibleAccess: false,
        eligibilityLabel: "No eligible credit or subscription",
      })),
    };
  }

  const requiredScope = resolveEntitlementScope({ serviceScope: sessionClassCategory.classType.serviceScope, categorySlug: sessionClassCategory.classType.category.slug });
  const availableCreditsByClientId = await getClientAvailableCreditsByScope({
    clientIds: clients.map((client) => client.id),
    requiredScope,
  });
  const eligibleAccessByClientId = await getClientEligibleAccessByScope({
    clientIds: clients.map((client) => client.id),
    requiredScope,
  });

  return {
    templates,
    teachers,
    clients: clients.map((client) => {
      const availableCredits = availableCreditsByClientId.get(client.id) ?? 0;
      const eligibleAccess = eligibleAccessByClientId.get(client.id) ?? {
        hasEligibleAccess: false,
        eligibilityLabel: "No eligible credit or subscription",
      };
      return {
        ...client,
        availableCredits,
        hasAvailableCredits: availableCredits > 0,
        hasEligibleAccess: eligibleAccess.hasEligibleAccess,
        eligibilityLabel: eligibleAccess.eligibilityLabel,
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

