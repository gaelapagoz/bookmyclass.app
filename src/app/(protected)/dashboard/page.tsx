import Link from "next/link";
import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardHomeData } from "@/lib/dashboard/dashboard-service";

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const data = await getDashboardHomeData(session.user.id);

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Client Dashboard</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Welcome back, {data.userName}.</p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#8a5959]">Upcoming Booking</p>
          {data.nextUpcomingBooking ? (
            <>
              <p className="mt-2 font-medium text-[#6f2b2b]">{data.nextUpcomingBooking.serviceTitle}</p>
              <p className="mt-1 text-sm text-[#5f4040]">
                {formatDateTime(data.nextUpcomingBooking.startsAt)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[#5f4040]">No upcoming bookings.</p>
          )}
        </article>

        <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#8a5959]">Active Membership</p>
          {data.activeSubscription ? (
            <>
              <p className="mt-2 font-medium text-[#6f2b2b]">{data.activeSubscription.productName}</p>
              <p className="mt-1 text-sm text-[#5f4040]">
                Active until {formatDateTime(data.activeSubscription.currentPeriodEnd)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[#5f4040]">No active membership.</p>
          )}
        </article>

        <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#8a5959]">Credits Left</p>
          <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">{data.creditsLeft}</p>
        </article>

        <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#8a5959]">Loyalty Points</p>
          <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">{data.loyaltyPointsPlaceholder}</p>
          <p className="mt-1 text-xs text-[#7f5a5a]">Placeholder for upcoming loyalty features.</p>
        </article>
      </div>

      <section className="rounded-xl border border-[#d8cec6] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Recent Bookings</h2>
          <Link
            href="/dashboard/bookings"
            className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
          >
            View booking history
          </Link>
        </div>
        {data.recentBookings.length === 0 ? (
          <p className="mt-3 text-sm text-[#5f4040]">No bookings yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-[#5f4040]">
            {data.recentBookings.map((booking) => (
              <li
                key={booking.bookingId}
                className="flex flex-col justify-between gap-1 rounded-md border border-[#ebe1d8] px-3 py-2 sm:flex-row"
              >
                <span>{booking.serviceTitle}</span>
                <span>
                  {formatDateTime(booking.startsAt)} - {booking.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
