import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import AdminUsersRoleTable from "@/components/admin/AdminUsersRoleTable";
import { getAdminTeachersPageData } from "@/lib/admin/admin-user-service";

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
  return queryString ? `/admin/users/teachers?${queryString}` : "/admin/users/teachers";
}

export default async function AdminUsersTeachersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
} = {}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as Record<string, string | string[] | undefined>;
  const query = parseQuery(params.q);

  try {
    const pageData = await getAdminTeachersPageData({
      query,
      page: parsePage(params.page),
      pageSize: 20,
    });

    return (
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Teachers</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage teacher accounts.</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <form method="get" className="flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search name or email"
                aria-label="Search teachers"
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

        <AdminUsersRoleTable title="Teachers" users={pageData.items} />

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
        <h1 className="text-2xl font-semibold text-[#1f2735]">Teachers</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load teachers right now.</p>
      </section>
    );
  }
}

