import { prisma } from "@/lib/db";
import { StudioSessionStatus } from "@prisma/client";
import { getDateRangeUtc, getSiteDateKey, getSiteDateTimeLabel, getSiteTimeLabel } from "@/lib/public-catalogue/timezone";
import { getSiteTimeZone } from "@/lib/site-settings/site-settings-service";

export type KioskSelectableSession = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  confirmedBookingsCount: number;
  className: string;
  categorySlug: string;
  dateTimeLabel: string;
  timeLabel: string;
};

/**
 * Get all future collective class sessions available for kiosk check-in.
 * Filters out private classes and past sessions.
 * Used by teacher to select which session to monitor.
 */
export async function getKioskSelectableSessions(
  options?: {
    limit?: number;
    fromDate?: Date;
    timeZone?: string;
    toDate?: Date;
  },
): Promise<KioskSelectableSession[]> {
  const now = new Date();
  const limit = options?.limit ?? 20;
  const fromDate = options?.fromDate ?? now;
  const timeZone = options?.timeZone ?? (await getSiteTimeZone());

  const startsAt: Record<string, unknown> = {
    gte: fromDate,
  };
  if (options?.toDate) {
    startsAt.lt = options.toDate;
  }

  const sessions = await prisma.studioSession.findMany({
    where: {
      startsAt,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
      classType: {
        category: {
          // Exclude private classes
          slug: {
            not: {
              contains: "private",
            },
          },
        },
      },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      classType: {
        select: {
          name: true,
          category: {
            select: {
              slug: true,
            },
          },
        },
      },
      bookings: {
        where: {
          status: "CONFIRMED",
        },
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      startsAt: "asc",
    },
    take: limit,
  });

  return sessions.map((session) => ({
    id: session.id,
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    capacity: session.capacity,
    confirmedBookingsCount: session.bookings.length,
    className: session.classType.name,
    categorySlug: session.classType.category.slug,
    dateTimeLabel: getSiteDateTimeLabel(session.startsAt, timeZone),
    timeLabel: getSiteTimeLabel(session.startsAt, timeZone),
  }));
}

function buildTodayRange(now: Date, timeZone: string) {
  const dateKey = getSiteDateKey(now, timeZone);
  const { fromUtc, toUtc } = getDateRangeUtc(dateKey, timeZone);

  return { todayStart: fromUtc, tomorrowStart: toUtc };
}

export async function getKioskTodaySelectableSessions(now: Date = new Date()): Promise<KioskSelectableSession[]> {
  const timeZone = await getSiteTimeZone();
  const { todayStart, tomorrowStart } = buildTodayRange(now, timeZone);

  return getKioskSelectableSessions({
    fromDate: todayStart,
    toDate: tomorrowStart,
    limit: 30,
    timeZone,
  });
}

export async function getNextUpcomingKioskSelectableSession(now: Date = new Date()): Promise<KioskSelectableSession | null> {
  const sessions = await getKioskSelectableSessions({
    fromDate: now,
    limit: 1,
  });

  return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Get kiosk context for a specific session (preparation for check-in).
 * Verifies session exists and is eligible for check-in operations.
 */
export async function getKioskSessionContext(sessionId: string) {
  const timeZone = await getSiteTimeZone();
  const session = await prisma.studioSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      classType: {
        select: {
          name: true,
          category: {
            select: {
              slug: true,
            },
          },
        },
      },
      bookings: {
        where: {
          status: "CONFIRMED",
        },
        select: {
          id: true,
          clientId: true,
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
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const isPrivate = session.classType.category.slug.toLowerCase().includes("private");
  if (isPrivate) {
    throw new Error("PRIVATE_CLASSES_NOT_ELIGIBLE_FOR_KIOSK");
  }

  return {
    session: {
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      className: session.classType.name,
      dateTimeLabel: getSiteDateTimeLabel(session.startsAt, timeZone),
    },
    bookings: session.bookings,
  };
}
