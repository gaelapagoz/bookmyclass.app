import { requireTeacherSession } from "@/lib/auth/require-auth";
import { getTeacherAssignedSessions } from "@/lib/teacher/teacher-service";
import { SessionsWeeklyCalendar, type SessionCalendarItem } from "@/components/shared/SessionsWeeklyCalendar";
import { getSiteDateKey, getDateRangeUtc, isValidDateKey } from "@/lib/public-catalogue/timezone";
import { getSiteTimeZone } from "@/lib/site-settings/site-settings-service";

type SearchParams = Promise<{
  week?: string;
}>;

const HOUR_START = 6;
const HOUR_END = 22;
const DAYS_IN_WEEK = 7;

function parseDateOnly(value: string | undefined): string | null {
  if (!value || !isValidDateKey(value)) {
    return null;
  }
  return value;
}

function addDaysToDateKey(dateKey: string, amount: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const base = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + amount);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

function resolveWeekdayIndex(date: Date, timeZone: string): number {
  const weekdayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[weekdayLabel] ?? 0;
}

function resolveWeekStartDateKey(dateKey: string, timeZone: string): string {
  const { fromUtc } = getDateRangeUtc(dateKey, timeZone);
  const weekdayIndex = resolveWeekdayIndex(fromUtc, timeZone);
  return addDaysToDateKey(dateKey, -weekdayIndex);
}

function formatDate(input: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-BE", {
    timeZone,
    dateStyle: "medium",
  }).format(input);
}

export default async function TeacherSessionsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
} = {}) {
  const session = await requireTeacherSession({
    callbackUrl: "/teacher/sessions",
    unauthorizedPath: "/dashboard",
  });

  const params = (await (searchParams ?? Promise.resolve({}))) as { week?: string };
  const timeZone = await getSiteTimeZone();
  const today = new Date();
  const anchorDateKey = parseDateOnly(params.week) ?? getSiteDateKey(today, timeZone);
  const selectedStartDateKey = resolveWeekStartDateKey(anchorDateKey, timeZone);
  const selectedEndDateKey = addDaysToDateKey(selectedStartDateKey, DAYS_IN_WEEK);
  const previousWeek = addDaysToDateKey(selectedStartDateKey, -DAYS_IN_WEEK);
  const nextWeek = addDaysToDateKey(selectedStartDateKey, DAYS_IN_WEEK);
  const currentWeek = resolveWeekStartDateKey(getSiteDateKey(today, timeZone), timeZone);

  const selectedStart = getDateRangeUtc(selectedStartDateKey, timeZone).fromUtc;
  const selectedEnd = getDateRangeUtc(selectedEndDateKey, timeZone).fromUtc;
  const days = Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    getDateRangeUtc(addDaysToDateKey(selectedStartDateKey, index), timeZone).fromUtc,
  );
  const hours = Array.from(
    { length: HOUR_END - HOUR_START },
    (_, index) => HOUR_START + index,
  );

  try {
    const sessions = await getTeacherAssignedSessions({
      teacherUserId: session.user.id,
      weekStart: selectedStart,
      weekEnd: selectedEnd,
    });

    return (
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-[#1f2735]">My Sessions</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">
            Only sessions assigned to you are visible here.
          </p>
        </header>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-[#334155]">
              Week of {formatDate(selectedStart, timeZone)}
            </h2>
            <div className="flex items-center gap-2 text-sm">
              <a
                href={`/teacher/sessions?week=${previousWeek}`}
                className="rounded-md border border-[#c8d2df] px-3 py-1.5 text-[#334155] hover:bg-[#f4f7fb]"
              >
                Previous week
              </a>
              <a
                href={`/teacher/sessions?week=${currentWeek}`}
                className="rounded-md border border-[#c8d2df] px-3 py-1.5 text-[#334155] hover:bg-[#f4f7fb]"
              >
                Today
              </a>
              <a
                href={`/teacher/sessions?week=${nextWeek}`}
                className="rounded-md border border-[#c8d2df] px-3 py-1.5 text-[#334155] hover:bg-[#f4f7fb]"
              >
                Next week
              </a>
            </div>
          </div>

          {sessions.length === 0 ? (
            <p className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#4b5a72]">
              No sessions assigned to you for this week.
            </p>
          ) : (
            <SessionsWeeklyCalendar
              sessions={sessions.map((s): SessionCalendarItem => ({
                ...s,
                href: `/teacher/sessions/${s.id}`,
              }))}
              days={days}
              hours={hours}
              timeZone={timeZone}
            />
          )}
        </section>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">My Sessions</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">
          Unable to load sessions right now.
        </p>
      </section>
    );
  }
}
