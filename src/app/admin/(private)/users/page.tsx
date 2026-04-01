import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import AdminUsersRoleTable from "@/components/admin/AdminUsersRoleTable";
import { getAdminUsersData, getAdminUsersGroupedPageData } from "@/lib/admin/admin-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type GroupPageParam = "masterAdminsPage" | "adminsPage" | "teachersPage" | "clientsPage";

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

function buildUsersHref(
  params: Record<string, string | string[] | undefined>,
  updates: Partial<Record<"q" | GroupPageParam, string>>,
): string {
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
  return queryString ? `/admin/users?${queryString}` : "/admin/users";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
} = {}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as Record<
    string,
    string | string[] | undefined
  >;
  const query = parseQuery(params.q);
  const filterByQuery = (value: { name: string; email: string }) =>
    !query ||
    value.name.toLowerCase().includes(query.toLowerCase()) ||
    value.email.toLowerCase().includes(query.toLowerCase());

  try {
    const fallbackData = async () => {
      const items = await getAdminUsersData();
      return {
        query,
        masterAdmins: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 1,
          items: items.filter((item) => item.role === "MASTER_ADMIN" && filterByQuery(item)),
        },
        admins: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 1,
          items: items.filter((item) => item.role === "ADMIN" && filterByQuery(item)),
        },
        teachers: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 1,
          items: items.filter((item) => item.role === "TEACHER" && filterByQuery(item)),
        },
        clients: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 1,
          items: items.filter((item) => item.role === "CLIENT" && filterByQuery(item)),
        },
      };
    };

    let data: Awaited<ReturnType<typeof fallbackData>>;
    if (typeof getAdminUsersGroupedPageData === "function") {
      const grouped = await getAdminUsersGroupedPageData({
        query,
        pageSize: 20,
        masterAdminsPage: parsePage(params.masterAdminsPage),
        adminsPage: parsePage(params.adminsPage),
        teachersPage: parsePage(params.teachersPage),
        clientsPage: parsePage(params.clientsPage),
      });

      if (grouped?.masterAdmins && grouped?.admins && grouped?.teachers && grouped?.clients) {
        data = grouped;
      } else {
        data = await fallbackData();
      }
    } else {
      data = await fallbackData();
    }

    const sections = [
      { title: "Master Admins", pageParam: "masterAdminsPage", pageData: data.masterAdmins },
      { title: "Admins", pageParam: "adminsPage", pageData: data.admins },
      { title: "Teachers", pageParam: "teachersPage", pageData: data.teachers },
      { title: "Clients / Users", pageParam: "clientsPage", pageData: data.clients },
    ] as const;

    return (
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Users</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage users and access roles.</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <form method="get" className="flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={data.query}
                placeholder="Search name or email"
                aria-label="Search users"
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

        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.pageParam} className="space-y-2">
              <AdminUsersRoleTable title={section.title} users={section.pageData.items} />
              <AdminPagination
                page={section.pageData.page}
                totalPages={section.pageData.totalPages}
                onChange={(nextPage) =>
                  buildUsersHref(params, {
                    [section.pageParam]: String(nextPage),
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Users</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load users right now.</p>
      </section>
    );
  }
}
