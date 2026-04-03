import AdminListControls from "@/components/admin/AdminListControls";
import AdminPagination from "@/components/admin/AdminPagination";
import { getBookings, type AdminBookingStatusFilter } from "@/lib/admin/admin-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_OPTIONS: Array<{ value: AdminBookingStatusFilter; label: string }> = [
  { value: "all", label: "All Items" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "completed", label: "Completed" },
  { value: "noShow", label: "No-show" },
];

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function parseFilter(value: string | string[] | undefined): AdminBookingStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "pending" || raw === "confirmed" || raw === "cancelled" || raw === "completed" || raw === "noShow") {
    return raw;
  }
  return "all";
}

function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function buildPageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") {
      continue;
    }

    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized) {
      query.set(key, normalized);
    }
  }

  query.set("page", String(page));
  return `/admin/bookings?${query.toString()}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const filter = parseFilter(params.filter);
  const query = parseQuery(params.q);

  try {
    const bookings = await getBookings({ page, pageSize: 20, filter, query });

    return (
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Booking List</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Track booking-list status and customer information.</p>
          </div>

          <AdminListControls
            basePath="/admin/bookings"
            filterName="filter"
            filterValue={filter}
            filterOptions={FILTER_OPTIONS}
            searchName="q"
            searchValue={query}
            searchPlaceholder="Search customer, email, or session"
            searchAriaLabel="Search bookings"
          />
        </header>

        {bookings.data.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {bookings.data.map((item) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AdminPagination
          page={page}
          totalPages={bookings.totalPages}
          onChange={(nextPage) => buildPageHref(params, nextPage)}
        />
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Booking List</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load booking list right now.</p>
      </section>
    );
  }
}


