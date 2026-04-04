import { BookingStatus, StudioSessionStatus, Weekday } from "@prisma/client";

import { prisma } from "@/lib/db";

export type HomeAgendaDayRow = {
  day: string;
  classes: string[];
};

const WEEK_DAYS: Array<{ day: Weekday; label: string }> = [
  { day: Weekday.MONDAY, label: "Monday" },
  { day: Weekday.TUESDAY, label: "Tuesday" },
  { day: Weekday.WEDNESDAY, label: "Wednesday" },
  { day: Weekday.THURSDAY, label: "Thursday" },
  { day: Weekday.FRIDAY, label: "Friday" },
  { day: Weekday.SATURDAY, label: "Saturday" },
  { day: Weekday.SUNDAY, label: "Sunday" },
];

export async function getHomeAgendaTableFromSchedule(): Promise<HomeAgendaDayRow[]> {
  const entries = await prisma.siteWeeklyScheduleEntry.findMany({
    where: {
      isActive: true,
    },
    orderBy: [{ dayOfWeek: "asc" }, { displayOrder: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
    select: {
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      label: true,
    },
  });

  const byDay = new Map<Weekday, string[]>();
  for (const entry of entries) {
    const existing = byDay.get(entry.dayOfWeek) ?? [];
    existing.push(`${entry.startTime}-${entry.endTime} ${entry.label}`);
    byDay.set(entry.dayOfWeek, existing);
  }

  return WEEK_DAYS.map((entry) => ({
    day: entry.label,
    classes: byDay.get(entry.day) ?? [],
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
