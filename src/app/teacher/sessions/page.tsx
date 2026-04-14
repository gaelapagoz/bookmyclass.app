import { requireTeacherSession } from "@/lib/auth/require-auth";
import { getTeacherAssignedSessions } from "@/lib/teacher/teacher-service";
import { SessionsWeeklyCalendar, type SessionCalendarItem } from "@/components/shared/SessionsWeeklyCalendar";

type SearchParams = Promise<{
  week?: string;
}>;

const HOUR_START = 6;
const HOUR_END = 22;
const DAYS_IN_WEEK = 7;

function parseDateOnly(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeek(input: Date): Date {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function addDays(input: Date, amount: number): Date {
  const date = new Date(input);
  date.setDate(date.getDate() + amount);
  return date;
}

function toDateKey(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const day = String(input.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(input: Date): string {
  return new Intl.DateTimeFormat("en-BE", {
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
  const today = new Date();
  const selectedStart = startOfWeek(parseDateOnly(params.week) ?? today);
  const selectedEnd = addDays(selectedStart, DAYS_IN_WEEK);

  const previousWeek = toDateKey(addDays(selectedStart, -DAYS_IN_WEEK));
  const nextWeek = toDateKey(addDays(selectedStart, DAYS_IN_WEEK));
  const currentWeek = toDateKey(startOfWeek(today));

  const days = Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    addDays(selectedStart, index),
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
              Week of {formatDate(selectedStart)}
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
              weekStart={selectedStart}
              days={days}
              hours={hours}
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

