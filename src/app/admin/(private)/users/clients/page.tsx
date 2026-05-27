import Link from "next/link";

import {
  bulkAddClientMarketingSegmentsAction,
  bulkRemoveClientMarketingSegmentsAction,
  bulkSetClientMarketingSubscriptionStatusAction,
} from "@/app/admin/(private)/actions";
import AdminPagination from "@/components/admin/AdminPagination";
import AdminUsersRoleTable from "@/components/admin/AdminUsersRoleTable";
import {
  getAdminClientStats,
  getAdminClientsPageData,
  listAdminMarketingSegmentOptions,
} from "@/lib/admin/admin-user-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getSingleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined): number {
  const parsed = Number(getSingleParam(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function parseQuery(value: string | string[] | undefined): string {
  return (getSingleParam(value) ?? "").trim();
}

function buildUsersHref(params: Record<string, string | string[] | undefined>, updates: Partial<Record<"q" | "page", string>>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const normalized = getSingleParam(value);
    if (normalized) {
      query.set(key, normalized);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!value) {
      query.delete(key);
      continue;
    }
    query.set(key, value);
  }

  const queryString = query.toString();
  return queryString ? `/admin/users/clients?${queryString}` : "/admin/users/clients";
}

export default async function AdminUsersClientsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
} = {}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as Record<string, string | string[] | undefined>;
  const query = parseQuery(params.q);

  try {
    const [pageData, stats, marketingSegments] = await Promise.all([
      getAdminClientsPageData({
        query,
        page: parsePage(params.page),
        pageSize: 20,
      }),
      getAdminClientStats(),
      listAdminMarketingSegmentOptions(),
    ]);

    return (
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Clients</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage client accounts and subscription state.</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <form method="get" className="flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search name or email"
                aria-label="Search clients"
                className="w-64 rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm text-[#1f2735]"
              />
              <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
                Search
              </button>
            </form>

            <Link href="/admin/users/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
              Create user
            </Link>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Number of Client</p>
            <p className="mt-1 text-2xl font-semibold text-[#1f2735]">{stats.totalClients}</p>
          </article>
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Never Subscribed</p>
            <p className="mt-1 text-2xl font-semibold text-[#1f2735]">{stats.neverSubscribedClients}</p>
          </article>
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Subscribed</p>
            <p className="mt-1 text-2xl font-semibold text-[#1f2735]">{stats.subscribedClients}</p>
          </article>
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Unsubscribed</p>
            <p className="mt-1 text-2xl font-semibold text-[#1f2735]">{stats.unsubscribedClients}</p>
          </article>
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total Number of Subscription</p>
            <p className="mt-1 text-2xl font-semibold text-[#1f2735]">{stats.totalSubscriptions}</p>
          </article>
        </div>

        <AdminUsersRoleTable
          title="Clients"
          users={pageData.items}
          marketingBulkActions={{
            segments: marketingSegments.map((segment) => ({
              id: segment.id,
              name: segment.name,
            })),
            setStatusAction: bulkSetClientMarketingSubscriptionStatusAction,
            addSegmentsAction: bulkAddClientMarketingSegmentsAction,
            removeSegmentsAction: bulkRemoveClientMarketingSegmentsAction,
          }}
        />

        <AdminPagination
          page={pageData.page}
          totalPages={pageData.totalPages}
          onChange={(nextPage) =>
            buildUsersHref(params, {
              page: String(nextPage),
            })
          }
        />
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Clients</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load clients right now.</p>
      </section>
    );
  }
}

