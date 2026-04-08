import { StudioSessionStatus } from "@prisma/client";
import { prisma } from "../db";
import { createPerfTrace, type PerfTrace } from "../monitoring/perf-trace";
import { bookingDraftActiveBookingFilter } from "../public-booking/booking-draft-service";
import { getPublicTeacherName } from "../public-content/teacher-display";
import {
  STUDIO_TIMEZONE,
  getDateRangeUtc,
  getMonthRangeUtc,
  getStudioDateKey,
  getStudioTimeLabel,
} from "./timezone";

export type PublicServiceDetail = {
  classSummary: {
    duration: string;
    location: string;
    teacher: string;
    title: "Class Summary";
  };
  description: string;
  id: string;
  imageUrl: string | null;
  shortDescription: string;
  slug: string;
  title: string;
};

export type SessionSlot = {
  availableSpots: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  isAvailable: boolean;
  startTime: string;
};

type SessionWithBookings = {
  capacity: number;
  endsAt: Date;
  id: string;
  startsAt: Date;
  _count: {
    bookings: number;
  };
};

function getShortDescription(description: string | null): string {
  if (!description) {
    return "Details coming soon.";
  }

  const trimmed = description.trim();
  if (trimmed.length <= 140) {
    return trimmed;
  }

  return `${trimmed.slice(0, 137).trimEnd()}...`;
}

function toSlot(session: SessionWithBookings): SessionSlot {
  const usedSpots = session._count.bookings;
  const availableSpots = Math.max(0, session.capacity - usedSpots);

  return {
    id: session.id,
    date: getStudioDateKey(session.startsAt),
    startTime: getStudioTimeLabel(session.startsAt),
    endTime: getStudioTimeLabel(session.endsAt),
    capacity: session.capacity,
    availableSpots,
    isAvailable: availableSpots > 0,
  };
}

async function getServiceIdBySlug(slug: string, trace?: PerfTrace) {
  const query = () =>
    prisma.classType.findFirst({
      where: {
        slug,
        isActive: true,
        isVisible: true,
        category: {
          isActive: true,
        },
      },
      select: {
        id: true,
      },
    });

  return trace ? trace.db("classType.findFirst.serviceIdBySlug", query) : query();
}

async function getServiceDetailRecordBySlug(slug: string, trace?: PerfTrace) {
  const query = () =>
    prisma.classType.findFirst({
      where: {
        slug,
        isActive: true,
        isVisible: true,
        category: {
          isActive: true,
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        defaultDurationMinutes: true,
        templates: {
          where: {
            isActive: true,
            isPublished: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
          select: {
            location: true,
            defaultTeacher: {
              select: {
                firstName: true,
                lastName: true,
                name: true,
              },
            },
          },
        },
        studioSessions: {
          where: {
            isPublished: true,
            status: StudioSessionStatus.SCHEDULED,
            startsAt: {
              gte: new Date(),
            },
          },
          orderBy: {
            startsAt: "asc",
          },
          take: 1,
          select: {
            location: true,
            teacher: {
              select: {
                firstName: true,
                lastName: true,
                name: true,
              },
            },
          },
        },
      },
    });

  return trace ? trace.db("classType.findFirst.serviceDetailBySlug", query) : query();
}

function resolveClassSummary(classType: NonNullable<Awaited<ReturnType<typeof getServiceDetailRecordBySlug>>>) {
  const upcomingSession = classType.studioSessions[0] ?? null;
  const activeTemplate = classType.templates[0] ?? null;

  const teacher = upcomingSession?.teacher
    ? getPublicTeacherName(upcomingSession.teacher)
    : activeTemplate?.defaultTeacher
      ? getPublicTeacherName(activeTemplate.defaultTeacher)
      : "";
  const location = upcomingSession?.location?.trim() || activeTemplate?.location?.trim() || "Studio location";

  return {
    title: "Class Summary" as const,
    duration: `${classType.defaultDurationMinutes} minutes`,
    teacher,
    location,
  };
}

export async function getPublicServiceDetailBySlug(slug: string): Promise<PublicServiceDetail | null> {
  const trace = createPerfTrace("public-catalogue.getPublicServiceDetailBySlug", { slug });
  let foundService = false;
  try {
    const classType = await getServiceDetailRecordBySlug(slug, trace);

    if (!classType) {
      return null;
    }
    foundService = true;

    return {
      id: classType.id,
      slug: classType.slug,
      title: classType.name,
      description: classType.description ?? "Description coming soon.",
      shortDescription: getShortDescription(classType.description),
      imageUrl: classType.imageUrl,
      classSummary: resolveClassSummary(classType),
    };
  } finally {
    trace.log({ foundService });
  }
}

export async function getServiceMonthAvailability(params: { monthKey: string; slug: string }) {
  const { monthKey, slug } = params;
  const trace = createPerfTrace("public-catalogue.getServiceMonthAvailability", {
    monthKey,
    slug,
  });
  let sessionCount = 0;
  let foundService = false;
  try {
    const classType = await getServiceIdBySlug(slug, trace);

    if (!classType) {
      return null;
    }
    foundService = true;

    const { fromUtc, toUtc } = getMonthRangeUtc(monthKey);

    const sessions = await trace.db("studioSession.findMany.monthAvailability", () =>
      prisma.studioSession.findMany({
        where: {
          classTypeId: classType.id,
          isPublished: true,
          status: StudioSessionStatus.SCHEDULED,
          startsAt: {
            gte: fromUtc,
            lt: toUtc,
          },
        },
        orderBy: {
          startsAt: "asc",
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          _count: {
            select: {
              bookings: {
                where: bookingDraftActiveBookingFilter(),
              },
            },
          },
        },
      }),
    );
    sessionCount = sessions.length;

    const byDate = new Map<string, { availableSlots: number; totalSlots: number }>();
    for (const session of sessions) {
      const slot = toSlot(session);
      const current = byDate.get(slot.date) ?? { availableSlots: 0, totalSlots: 0 };
      current.totalSlots += 1;
      if (slot.isAvailable) {
        current.availableSlots += 1;
      }
      byDate.set(slot.date, current);
    }

    const days = Array.from(byDate.entries()).map(([date, value]) => ({
      date,
      totalSlots: value.totalSlots,
      availableSlots: value.availableSlots,
      hasAvailability: value.availableSlots > 0,
    }));

    days.sort((left, right) => left.date.localeCompare(right.date));

    return {
      month: monthKey,
      timezone: STUDIO_TIMEZONE,
      days,
    };
  } finally {
    trace.log({ foundService, sessionCount });
  }
}

export async function getServiceSlotsByDate(params: { dateKey: string; slug: string }) {
  const { dateKey, slug } = params;
  const trace = createPerfTrace("public-catalogue.getServiceSlotsByDate", { dateKey, slug });
  let sessionCount = 0;
  let foundService = false;
  try {
    const classType = await getServiceIdBySlug(slug, trace);

    if (!classType) {
      return null;
    }
    foundService = true;

    const { fromUtc, toUtc } = getDateRangeUtc(dateKey);
    const now = new Date();

    const sessions = await trace.db("studioSession.findMany.slotsByDate", () =>
      prisma.studioSession.findMany({
        where: {
          classTypeId: classType.id,
          isPublished: true,
          status: StudioSessionStatus.SCHEDULED,
          startsAt: {
            gte: fromUtc > now ? fromUtc : now,
            lt: toUtc,
          },
        },
        orderBy: {
          startsAt: "asc",
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          _count: {
            select: {
              bookings: {
                where: bookingDraftActiveBookingFilter(),
              },
            },
          },
        },
      }),
    );
    sessionCount = sessions.length;

    const slots = sessions.map(toSlot);
    return {
      date: dateKey,
      timezone: STUDIO_TIMEZONE,
      slots,
    };
  } finally {
    trace.log({ foundService, sessionCount });
  }
}

export async function getNextAvailability(params: { fromDateKey: string; slug: string }) {
  const { fromDateKey, slug } = params;
  const trace = createPerfTrace("public-catalogue.getNextAvailability", { fromDateKey, slug });
  let sessionCount = 0;
  let foundService = false;
  let nextFound = false;
  try {
    const classType = await getServiceIdBySlug(slug, trace);

    if (!classType) {
      return null;
    }
    foundService = true;

    const { fromUtc } = getDateRangeUtc(fromDateKey);
    const now = new Date();
    const queryFrom = fromUtc > now ? fromUtc : now;

    const sessions = await trace.db("studioSession.findMany.nextAvailability", () =>
      prisma.studioSession.findMany({
        where: {
          classTypeId: classType.id,
          isPublished: true,
          status: StudioSessionStatus.SCHEDULED,
          startsAt: {
            gte: queryFrom,
          },
        },
        orderBy: {
          startsAt: "asc",
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          _count: {
            select: {
              bookings: {
                where: bookingDraftActiveBookingFilter(),
              },
            },
          },
        },
        take: 180,
      }),
    );
    sessionCount = sessions.length;

    const firstAvailable = sessions.map(toSlot).find((slot) => slot.isAvailable);
    if (!firstAvailable) {
      return {
        next: null,
        timezone: STUDIO_TIMEZONE,
      };
    }
    nextFound = true;

    return {
      timezone: STUDIO_TIMEZONE,
      next: {
        ...firstAvailable,
        month: firstAvailable.date.slice(0, 7),
      },
    };
  } finally {
    trace.log({ foundService, nextFound, sessionCount });
  }
}
