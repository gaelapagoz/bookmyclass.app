import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import { getAdminSubscriptionsPageData } from "@/lib/admin/admin-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
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
  return `/admin/subscriptions?${query.toString()}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminSubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = parsePage(params.page);

  try {
    const data = await getAdminSubscriptionsPageData({ page, pageSize: 20 });

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Subscriptions</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage client contracts and membership lifecycle state.</p>
          </div>
          <Link href="/admin/subscriptions/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Create subscription
          </Link>
        </header>

        {data.items.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">No subscriptions found.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Current Period</th>
                  <th className="px-3 py-2">Renewal/Cancellation</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">
                      {item.clientName}
                      <p className="text-xs text-[#5a6d86]">{item.clientEmail}</p>
                    </td>
                    <td className="px-3 py-2">
                      {item.productName}
                      <p className="text-xs text-[#5a6d86]">{item.priceName}</p>
                    </td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">
                      {formatDate(item.currentPeriodStart)}
                      <p className="text-xs text-[#5a6d86]">to {formatDate(item.currentPeriodEnd)}</p>
                    </td>
                    <td className="px-3 py-2">
                      {item.cancelAtPeriodEnd ? "Cancels at period end" : "Auto-renew"}
                      <p className="text-xs text-[#5a6d86]">Cancelled: {formatDate(item.cancelledAt)}</p>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/subscriptions/${item.id}/edit`}
                        className="text-[#2a4f78] underline underline-offset-4"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AdminPagination
          page={data.page}
          totalPages={data.totalPages}
          onChange={(nextPage) => buildPageHref(params, nextPage)}
        />
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Subscriptions</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load subscriptions right now.</p>
      </section>
    );
  }
}
