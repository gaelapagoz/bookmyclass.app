import Link from "next/link";

import { getAdminDashboardData } from "@/lib/admin/admin-service";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminDashboardPage() {
  try {
    const data = await getAdminDashboardData();

    return (
      <section className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Dashboard</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Operational summary for the studio.</p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Upcoming Sessions</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.upcomingSessionsCount}</p>
          </article>

          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Bookings</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.bookingsCount}</p>
          </article>

          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Active Contracts</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.activePlansCount}</p>
          </article>

          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Active Entitlements</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.activeEntitlementsCount}</p>
          </article>
        </div>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#1f2735]">Recent Bookings</h2>
            <Link href="/admin/bookings" className="text-sm text-[#2a4f78] underline underline-offset-4">
              View all bookings
            </Link>
          </div>

          {data.recentBookings.length === 0 ? (
            <p className="mt-3 text-sm text-[#4b5a72]">No bookings yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.recentBookings.map((booking) => (
                <li key={booking.id} className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#334155]">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">{booking.sessionTitle}</span>
                    <span className="text-xs uppercase tracking-wide">{booking.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#5a6d86]">
                    {booking.clientName} ({booking.clientEmail}) · {formatDateTime(booking.startsAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Dashboard</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load dashboard data right now.</p>
      </section>
    );
  }
}

