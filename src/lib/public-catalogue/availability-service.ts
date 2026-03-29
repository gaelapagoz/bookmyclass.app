import { BookingStatus, StudioSessionStatus } from "@prisma/client";
import { prisma } from "../db";
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
  bookings: Array<{ id: string }>;
  capacity: number;
  endsAt: Date;
  id: string;
  startsAt: Date;
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
  const usedSpots = session.bookings.length;
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

async function getServiceRecordBySlug(slug: string) {
  return prisma.classType.findFirst({
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
}

function resolveClassSummary(classType: NonNullable<Awaited<ReturnType<typeof getServiceRecordBySlug>>>) {
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
  const classType = await getServiceRecordBySlug(slug);

  if (!classType) {
    return null;
  }

  return {
    id: classType.id,
    slug: classType.slug,
    title: classType.name,
    description: classType.description ?? "Description coming soon.",
    shortDescription: getShortDescription(classType.description),
    imageUrl: classType.imageUrl,
    classSummary: resolveClassSummary(classType),
  };
}

export async function getServiceMonthAvailability(params: { monthKey: string; slug: string }) {
  const { monthKey, slug } = params;
  const classType = await getServiceRecordBySlug(slug);

  if (!classType) {
    return null;
  }

  const { fromUtc, toUtc } = getMonthRangeUtc(monthKey);

  const sessions = await prisma.studioSession.findMany({
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
}

export async function getServiceSlotsByDate(params: { dateKey: string; slug: string }) {
  const { dateKey, slug } = params;
  const classType = await getServiceRecordBySlug(slug);

  if (!classType) {
    return null;
  }

  const { fromUtc, toUtc } = getDateRangeUtc(dateKey);
  const now = new Date();

  const sessions = await prisma.studioSession.findMany({
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

  const slots = sessions.map(toSlot);
  return {
    date: dateKey,
    timezone: STUDIO_TIMEZONE,
    slots,
  };
}

export async function getNextAvailability(params: { fromDateKey: string; slug: string }) {
  const { fromDateKey, slug } = params;
  const classType = await getServiceRecordBySlug(slug);

  if (!classType) {
    return null;
  }

  const { fromUtc } = getDateRangeUtc(fromDateKey);
  const now = new Date();
  const queryFrom = fromUtc > now ? fromUtc : now;

  const sessions = await prisma.studioSession.findMany({
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
    take: 180,
  });

  const firstAvailable = sessions.map(toSlot).find((slot) => slot.isAvailable);
  if (!firstAvailable) {
    return {
      next: null,
      timezone: STUDIO_TIMEZONE,
    };
  }

  return {
    timezone: STUDIO_TIMEZONE,
    next: {
      ...firstAvailable,
      month: firstAvailable.date.slice(0, 7),
    },
  };
}
