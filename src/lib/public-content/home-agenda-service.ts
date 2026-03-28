import { BookingStatus, StudioSessionStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

export type HomeAgendaDayRow = {
  day: string;
  classes: string[];
};

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function startOfWeekMonday(input: Date): Date {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("en-BE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export async function getHomeAgendaTableFromSchedule(): Promise<HomeAgendaDayRow[]> {
  const now = new Date();
  const weekStart = startOfWeekMonday(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const sessions = await prisma.studioSession.findMany({
    where: {
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
      startsAt: {
        gte: weekStart,
        lte: weekEnd,
      },
    },
    orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    select: {
      title: true,
      startsAt: true,
      endsAt: true,
    },
  });

  const byDay = new Map<number, string[]>();
  for (const session of sessions) {
    const dayIndex = session.startsAt.getDay();
    if (dayIndex === 0) {
      continue;
    }
    const existing = byDay.get(dayIndex) ?? [];
    existing.push(`${formatTime(session.startsAt)}-${formatTime(session.endsAt)} ${session.title}`);
    byDay.set(dayIndex, existing);
  }

  return WEEK_DAYS.map((day, index) => ({
    day,
    classes: byDay.get(index + 1) ?? [],
  }));
}

export async function getManageSiteAgendaPreview() {
  const now = new Date();
  const sessions = await prisma.studioSession.findMany({
    where: {
      status: StudioSessionStatus.SCHEDULED,
      startsAt: {
        gte: now,
      },
    },
    orderBy: [{ startsAt: "asc" }],
    take: 8,
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      bookings: {
        where: {
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
          },
        },
        select: { id: true },
      },
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    title: session.title,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    bookedSpots: session.bookings.length,
    capacity: session.capacity,
  }));
}
