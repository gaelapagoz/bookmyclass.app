import Link from "next/link";
import { getKioskTodaySelectableSessions, getNextUpcomingKioskSelectableSession } from "@/lib/kiosk/kiosk-service";
import { requireStaffSession } from "@/lib/auth/require-auth";

export default async function KioskPage() {
  await requireStaffSession({
    callbackUrl: "/kiosk",
    unauthorizedPath: "/sign-in",
  });

  const nowUtc = new Date();
  const todaySessions = await getKioskTodaySelectableSessions(nowUtc);
  const upcomingSessions = todaySessions.filter((s) => s.startsAt > nowUtc);
  const ongoingSessions = todaySessions.filter((s) => s.startsAt <= nowUtc && s.endsAt > nowUtc);

  // If no sessions today, get the next upcoming session
  let nextUpcomingSession = null;
  if (todaySessions.length === 0) {
    nextUpcomingSession = await getNextUpcomingKioskSelectableSession(nowUtc);
  }

  return (
    <div className="space-y-6">
      {ongoingSessions.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[#1f2735]">Live Now</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ongoingSessions.map((session) => (
              <Link
                key={session.id}
                href={`/kiosk/${session.id}`}
                className="group rounded-xl border-2 border-[#d3dbe5] bg-white p-4 transition-all hover:border-[#7b2d2d] hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1f2735] group-hover:text-[#7b2d2d]">{session.title}</h3>
                    <p className="mt-1 text-sm text-[#4b5a72]">{session.className}</p>
                  </div>
                  <span className="ml-2 inline-block rounded-full bg-[#2a4f78] px-2 py-1 text-xs font-medium text-white">
                    Live
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-[#4b5a72]">
                  <span>{session.confirmedBookingsCount} bookings</span>
                  <span className="text-xs">→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {upcomingSessions.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[#1f2735]">
            {ongoingSessions.length > 0 ? "Later Today" : "Today's Classes"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingSessions.map((session) => {
              return (
                <Link
                  key={session.id}
                  href={`/kiosk/${session.id}`}
                  className="group rounded-xl border border-[#d3dbe5] bg-white p-4 transition-all hover:border-[#7b2d2d] hover:shadow-md"
                >
                  <div>
                    <h3 className="font-semibold text-[#1f2735] group-hover:text-[#7b2d2d]">{session.title}</h3>
                    <p className="mt-1 text-sm text-[#4b5a72]">{session.className}</p>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-[#4b5a72]">
                    <p>{session.timeLabel}</p>
                    <p>{session.confirmedBookingsCount} bookings</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {todaySessions.length === 0 && nextUpcomingSession && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[#1f2735]">No More Classes Today</h2>
          <div className="rounded-xl border border-[#d8cec6] bg-[#f9f7f4] p-6">
            <p className="text-[#4b5a72] mb-4">Next upcoming collective class:</p>
            <Link
              href={`/kiosk/${nextUpcomingSession.id}`}
              className="group block rounded-xl border border-[#d3dbe5] bg-white p-4 transition-all hover:border-[#7b2d2d] hover:shadow-md"
            >
              <div>
                <h3 className="font-semibold text-[#1f2735] group-hover:text-[#7b2d2d]">{nextUpcomingSession.title}</h3>
                <p className="mt-1 text-sm text-[#4b5a72]">{nextUpcomingSession.className}</p>
              </div>
              <div className="mt-3 space-y-1 text-sm text-[#4b5a72]">
                <p>
                  {nextUpcomingSession.dateTimeLabel}
                </p>
                <p>{nextUpcomingSession.confirmedBookingsCount} bookings</p>
              </div>
            </Link>
            <p className="mt-4 text-xs text-[#7b7b7b]">
              Check-in opens {Math.ceil((nextUpcomingSession.startsAt.getTime() - nowUtc.getTime()) / (1000 * 60 * 60))} hours from now
            </p>
          </div>
        </section>
      )}

      {todaySessions.length === 0 && !nextUpcomingSession && (
        <div className="rounded-xl border border-[#d8cec6] bg-[#f9f7f4] p-6 text-center">
          <p className="text-[#4b5a72]">No upcoming sessions available</p>
        </div>
      )}
    </div>
  );
}
