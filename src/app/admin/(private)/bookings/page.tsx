import Link from "next/link";

import { getAdminBookingsData } from "@/lib/admin/admin-service";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminBookingsPage() {
  try {
    const bookings = await getAdminBookingsData();

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Bookings</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Track booking status and customer information.</p>
          </div>
        </header>

        {bookings.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No bookings found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Booked At</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Payment Mode</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((item) => (
                  <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">
                      {item.customerName}
                      <p className="text-xs text-[#5a6d86]">{item.customerEmail}</p>
                    </td>
                    <td className="px-3 py-2">
                      {item.sessionTitle}
                      <p className="text-xs text-[#5a6d86]">{formatDateTime(item.startsAt)}</p>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(item.bookedAt)}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">{item.paymentSelection ?? "-"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/bookings/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Bookings</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load bookings right now.</p>
      </section>
    );
  }
}

