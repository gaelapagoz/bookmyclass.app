import Link from "next/link";
import { type StudioSessionStatus } from "@prisma/client";
import { getSessionWaitlistLabel } from "@/components/shared/session-waitlist-label";

export type SessionCalendarItem = {
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
  href?: string;
};

const HOUR_START = 6;
const HOUR_END = 22;
const DAYS_IN_WEEK = 7;

function getHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatDayHeader(input: Date): string {
  return new Intl.DateTimeFormat("en-BE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(input);
}

function formatTime(input: string): string {
  return new Intl.DateTimeFormat("en-BE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

function toDateKey(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const day = String(input.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupByDayHour(
  sessions: SessionCalendarItem[],
  weekStart: Date,
): Map<string, SessionCalendarItem[]> {
  const grouped = new Map<string, SessionCalendarItem[]>();

  for (const session of sessions) {
    const date = new Date(session.startsAt);
    const dayOffset = Math.floor(
      (date.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (dayOffset < 0 || dayOffset >= DAYS_IN_WEEK) {
      continue;
    }

    const hour = date.getHours();
    const key = `${dayOffset}-${hour}`;
    const existing = grouped.get(key) ?? [];
    existing.push(session);
    existing.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    grouped.set(key, existing);
  }

  return grouped;
}

interface SessionsWeeklyCalendarProps {
  sessions: SessionCalendarItem[];
  weekStart: Date;
  days: Date[];
  hours: number[];
}

export function SessionsWeeklyCalendar({
  sessions,
  weekStart,
  days,
  hours,
}: SessionsWeeklyCalendarProps) {
  const grouped = groupByDayHour(sessions, weekStart);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[84px_repeat(7,minmax(0,1fr))] border-y border-[#dbe3ee] bg-[#f5f8fc]">
          <div className="border-r border-[#dbe3ee] px-2 py-2 text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">
            Time
          </div>
          {days.map((day) => (
            <div
              key={toDateKey(day)}
              className="border-r border-[#dbe3ee] px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-[#5a6d86] last:border-r-0"
            >
              {formatDayHeader(day)}
            </div>
          ))}
        </div>

        {hours.map((hour) => (
          <div key={hour} className="grid grid-cols-[84px_repeat(7,minmax(0,1fr))] border-b border-[#edf2f7]">
            <div className="border-r border-[#edf2f7] px-2 py-3 text-xs text-[#64748b]">
              {getHourLabel(hour)}
            </div>
            {days.map((_, dayIndex) => {
              const key = `${dayIndex}-${hour}`;
              const slotSessions = grouped.get(key) ?? [];

              return (
                <div
                  key={key}
                  className="min-h-[94px] border-r border-[#edf2f7] p-1.5 last:border-r-0"
                >
                  <div className="space-y-1.5">
                    {slotSessions.map((session) => {
                      const waitlistLabel = getSessionWaitlistLabel(session.waitlistCount);

                      return (
                        <div key={session.id} className="rounded-md border border-[#bfd1e7] bg-[#eff5fb] px-2 py-1.5 text-xs text-[#1e293b]">
                          {session.href ? (
                            <Link href={session.href} className="block hover:bg-[#e2edf9]">
                              <p className="font-semibold leading-tight">
                                {session.className} - {session.title}
                              </p>
                              <p className="mt-1 text-[11px] text-[#334155]">
                                {formatTime(session.startsAt)} -{" "}
                                {formatTime(session.endsAt)}
                              </p>
                              <p className="text-[11px] text-[#334155]">
                                Teacher: {session.teacherName}
                              </p>
                              <p className="text-[11px] text-[#334155]">
                                {session.bookedCount}/{session.capacity} booked
                              </p>
                              {waitlistLabel ? <p className="text-[11px] text-[#334155]">{waitlistLabel}</p> : null}
                              {session.location ? (
                                <p className="truncate text-[11px] text-[#475569]">
                                  {session.location}
                                </p>
                              ) : null}
                            </Link>
                          ) : (
                            <>
                              <p className="font-semibold leading-tight">
                                {session.className} - {session.title}
                              </p>
                              <p className="mt-1 text-[11px] text-[#334155]">
                                {formatTime(session.startsAt)} -{" "}
                                {formatTime(session.endsAt)}
                              </p>
                              <p className="text-[11px] text-[#334155]">
                                Teacher: {session.teacherName}
                              </p>
                              <p className="text-[11px] text-[#334155]">
                                {session.bookedCount}/{session.capacity} booked
                              </p>
                              {waitlistLabel ? <p className="text-[11px] text-[#334155]">{waitlistLabel}</p> : null}
                              {session.location ? (
                                <p className="truncate text-[11px] text-[#475569]">
                                  {session.location}
                                </p>
                              ) : null}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
