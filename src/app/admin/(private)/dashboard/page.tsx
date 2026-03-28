import Link from "next/link";

import { getAdminDashboardData } from "@/lib/admin/admin-service";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSalesByCurrency(
  rows: Array<{
    currencyCode: string;
    amountMinor: number;
  }>,
): string {
  if (rows.length === 0) {
    return "-";
  }

  return rows
    .map((row) =>
      new Intl.NumberFormat("en-BE", {
        style: "currency",
        currency: row.currencyCode,
      }).format(row.amountMinor / 100),
    )
    .join(" + ");
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
          <div className="flex items-center gap-2">
            <Link href="/admin/inbox" className="text-sm text-[#2a4f78] underline underline-offset-4">
              Inbox
            </Link>
            <Link href="/admin/manage-site" className="text-sm text-[#2a4f78] underline underline-offset-4">
              Manage Site
            </Link>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[#1f2735]">Operational Diagnostics</h2>
          <div className="grid gap-4 xl:grid-cols-3">
            {data.diagnostics.map((period) => (
              <article key={period.key} className="rounded-xl border border-[#d3dbe5] bg-white p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[#2a4f78]">{period.label}</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Site Sessions</p>
                    <p className="mt-1 text-lg font-semibold text-[#1f2735]">{period.siteSessions}</p>
                  </div>
                  <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Sales</p>
                    <p className="mt-1 text-lg font-semibold text-[#1f2735]">
                      {formatSalesByCurrency(period.totalSalesByCurrency)}
                    </p>
                  </div>
                  <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Orders</p>
                    <p className="mt-1 text-lg font-semibold text-[#1f2735]">{period.totalOrders}</p>
                  </div>
                  <div className="rounded-md bg-[#f3f6fb] px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Bookings</p>
                    <p className="mt-1 text-lg font-semibold text-[#1f2735]">{period.totalBookings}</p>
                  </div>
                  <div className="rounded-md bg-[#f3f6fb] px-3 py-2 sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Cancellations</p>
                    <p className="mt-1 text-lg font-semibold text-[#1f2735]">{period.totalCancellations}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#1f2735]">Upcoming Sessions</h2>
            <Link href="/admin/sessions" className="text-sm text-[#2a4f78] underline underline-offset-4">
              View session schedule
            </Link>
          </div>

          {data.upcomingSessions.length === 0 ? (
            <p className="mt-3 text-sm text-[#4b5a72]">No upcoming sessions.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-[#e2e8f0]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                  <tr>
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">Date / Time</th>
                    <th className="px-3 py-2">Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingSessions.map((session) => (
                    <tr key={session.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2 font-medium">{session.title}</td>
                      <td className="px-3 py-2">{formatDateTime(session.startsAt)}</td>
                      <td className="px-3 py-2">
                        {session.bookedSpots}/{session.capacity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
