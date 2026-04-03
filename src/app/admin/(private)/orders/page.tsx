import AdminListControls from "@/components/admin/AdminListControls";
import AdminPagination from "@/components/admin/AdminPagination";
import { getAdminOrdersPageData, type AdminOrderDateFilter } from "@/lib/admin/admin-service";

type SearchParams = Promise<{
  page?: string | string[];
  filter?: string | string[];
  q?: string | string[];
}>;

const FILTER_OPTIONS: Array<{ value: AdminOrderDateFilter; label: string }> = [
  { value: "all", label: "All Items" },
  { value: "last7Days", label: "Last 7 days" },
  { value: "last30Days", label: "Last 30 days" },
  { value: "last90Days", label: "Last 90 days" },
];

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function parseFilter(value: string | string[] | undefined): AdminOrderDateFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "last7Days" || raw === "last30Days" || raw === "last90Days") {
    return raw;
  }
  return "all";
}

function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

function buildPageHref(page: number, filter: AdminOrderDateFilter, query: string) {
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("filter", filter);
  if (query) {
    search.set("q", query);
  }
  return `/admin/orders?${search.toString()}`;
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const filter = parseFilter(params.filter);
  const query = parseQuery(params.q);

  try {
    const data = await getAdminOrdersPageData({ page, filter, query, pageSize: 20 });

    return (
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Orders</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Read-only list of purchased order items.</p>
          </div>

          <AdminListControls
            basePath="/admin/orders"
            filterName="filter"
            filterValue={data.filter}
            filterOptions={FILTER_OPTIONS}
            searchName="q"
            searchValue={query}
            searchPlaceholder="Search client or product"
            searchAriaLabel="Search orders"
          />
        </header>

        {data.items.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">No orders found.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Purchased At</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2">{formatDate(item.purchasedAt)}</td>
                    <td className="px-3 py-2 font-medium">
                      {item.clientName}
                      <p className="text-xs text-[#5a6d86]">{item.clientEmail}</p>
                    </td>
                    <td className="px-3 py-2">{item.productName}</td>
                    <td className="px-3 py-2">{item.priceName}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">{formatMoney(item.lineTotalAmountMinor, item.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AdminPagination
          page={data.page}
          totalPages={data.totalPages}
          onChange={(nextPage) => buildPageHref(nextPage, data.filter, query)}
        />
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Orders</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load orders right now.</p>
      </section>
    );
  }
}
