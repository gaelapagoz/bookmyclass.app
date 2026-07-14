import Link from "next/link";
import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardHomeData } from "@/lib/dashboard/dashboard-service";
import {
  getClientLoyaltySummary,
  listClientLoyaltyHistory,
} from "@/lib/loyalty/loyalty-read-service";
import { resolvePrimaryLoyaltyCurrencyCode } from "@/lib/loyalty/loyalty-program-service";

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatPoints(points: number) {
  return new Intl.NumberFormat("en-BE").format(points);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
  }).format(new Date(iso));
}

function loyaltyEntryLabel(entryType: string) {
  switch (entryType) {
    case "EARN":
      return "Points Earned";
    case "MANUAL_GRANT":
      return "Points Adjustment";
    case "REVERSAL":
      return "Reversed";
    case "EXPIRE":
      return "Points expired";
    default:
      return entryType;
  }
}

function loyaltyEntryAmount(points: number) {
  return `${points > 0 ? "+" : ""}${formatPoints(points)} pts`;
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const loyaltyCurrencyCode = await resolvePrimaryLoyaltyCurrencyCode();
  const [data, loyalty, loyaltyHistory] = await Promise.all([
    getDashboardHomeData(session.user.id),
    getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: session.user.id },
      clientId: session.user.id,
      currencyCode: loyaltyCurrencyCode,
    }),
    listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: session.user.id },
      clientId: session.user.id,
      currencyCode: loyaltyCurrencyCode,
      limit: 3,
    }),
  ]);

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
          <p className="text-xs uppercase tracking-wide text-[#8a5959]">Class Credits</p>
          <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">{data.creditsLeft}</p>
        </article>

        <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#8a5959]">Points Balance</p>
          <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">{formatPoints(loyalty.balancePoints)}</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
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

        <section className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Recent Rewards Activity</h2>
          {loyaltyHistory.length === 0 ? (
            <p className="mt-3 text-sm text-[#5f4040]">No loyalty activity yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {loyaltyHistory.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[#ebe1d8] bg-[#fffaf7] px-4 py-3"
                >
                  <div>
                    <p className="text-base font-medium text-[#7b2d2d]">{loyaltyEntryLabel(entry.entryType)}</p>
                    <p className="text-sm text-[#8a5959]">{formatDate(entry.happenedAt.toISOString())}</p>
                  </div>
                  <p className="text-xl font-semibold text-[#7b2d2d]">{loyaltyEntryAmount(entry.amountPoints)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
