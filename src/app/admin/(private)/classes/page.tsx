import Link from "next/link";

import { createClassCategoryAction } from "@/app/admin/(private)/actions";
import { getAdminClassCategoriesData, getAdminClassesData } from "@/lib/admin/admin-catalog-core-service";

type SearchParams = Promise<{
  error?: string;
  success?: string;
  categoryPage?: string;
  coursePage?: string;
}>;

const PAGE_SIZE = 10;

function parsePage(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function paginate<T>(items: T[], page: number): { items: T[]; totalPages: number; page: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const normalizedPage = Math.min(page, totalPages);
  const startIndex = (normalizedPage - 1) * PAGE_SIZE;

  return {
    items: items.slice(startIndex, startIndex + PAGE_SIZE),
    totalPages,
    page: normalizedPage,
  };
}

function buildPageHref(input: {
  categoryPage: number;
  coursePage: number;
  nextCategoryPage?: number;
  nextCoursePage?: number;
}) {
  const query = new URLSearchParams();
  query.set("categoryPage", String(input.nextCategoryPage ?? input.categoryPage));
  query.set("coursePage", String(input.nextCoursePage ?? input.coursePage));
  return `/admin/classes?${query.toString()}`;
}

export default async function AdminClassesPage(
  { searchParams = Promise.resolve({}) }: { searchParams?: SearchParams } = {},
) {
  let classes: Awaited<ReturnType<typeof getAdminClassesData>> | null = null;
  let categories: Awaited<ReturnType<typeof getAdminClassCategoriesData>> | null = null;
  let loadFailed = false;
  const { error, success, categoryPage: rawCategoryPage, coursePage: rawCoursePage } = await searchParams;
  const categoryPage = parsePage(rawCategoryPage);
  const coursePage = parsePage(rawCoursePage);

  try {
    [classes, categories] = await Promise.all([getAdminClassesData(), getAdminClassCategoriesData()]);
  } catch {
    loadFailed = true;
  }

  const paginatedCategories = paginate(categories ?? [], categoryPage);
  const paginatedClasses = paginate(classes ?? [], coursePage);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Booking Services</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage booking service definitions.</p>
        </div>
        <Link href="/admin/classes/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
          Create booking service
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#276749]">{success}</p> : null}

      <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#1f2735]">Categories</h2>
        <form action={createClassCategoryAction} className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_120px_auto] md:items-end">
          <input type="hidden" name="returnCategoryPage" value={String(paginatedCategories.page)} />
          <input type="hidden" name="returnCoursePage" value={String(paginatedClasses.page)} />
          <label className="block text-sm text-[#334155]">
            Name
            <input name="name" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Description
            <input name="description" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Sort
            <input name="sortOrder" type="number" min={0} defaultValue={0} required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-sm text-[#334155]">
            <input type="checkbox" name="isActive" defaultChecked /> Active
          </label>
          <div className="md:col-span-4">
            <button type="submit" className="rounded-md border border-[#d3dbe5] px-4 py-2 text-sm hover:bg-[#f3f6fb]">
              Create category
            </button>
          </div>
        </form>

        {categories && categories.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Number of Services</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedCategories.items.map((category) => (
                  <tr key={category.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">{category.name}</td>
                    <td className="px-3 py-2">{category.serviceCount}</td>
                    <td className="px-3 py-2">{category.isActive ? "Active" : "Hidden"}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/classes/categories/${category.id}/edit?categoryPage=${paginatedCategories.page}&coursePage=${paginatedClasses.page}`}
                        className="text-[#2a4f78] underline underline-offset-4"
                        data-testid={`booking-category-edit-${category.id}`}
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paginatedCategories.totalPages > 1 ? (
              <div className="flex items-center justify-end gap-3 border-t border-[#e2e8f0] px-3 py-2 text-sm text-[#4b5a72]" data-testid="booking-categories-pagination">
                {paginatedCategories.page > 1 ? (
                  <Link
                    href={buildPageHref({
                      categoryPage: paginatedCategories.page,
                      coursePage: paginatedClasses.page,
                      nextCategoryPage: paginatedCategories.page - 1,
                    })}
                    className="text-[#2a4f78] underline underline-offset-4"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="text-[#94a3b8]">Previous</span>
                )}
                <span>{`Page ${paginatedCategories.page} of ${paginatedCategories.totalPages}`}</span>
                {paginatedCategories.page < paginatedCategories.totalPages ? (
                  <Link
                    href={buildPageHref({
                      categoryPage: paginatedCategories.page,
                      coursePage: paginatedClasses.page,
                      nextCategoryPage: paginatedCategories.page + 1,
                    })}
                    className="text-[#2a4f78] underline underline-offset-4"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="text-[#94a3b8]">Next</span>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {loadFailed || !classes ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#7b2d2d]">
          Unable to load booking services right now.
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
          No booking services found.
        </div>
      ) : (
        <section className="rounded-xl border border-[#d3dbe5] bg-white p-5" data-testid="booking-courses-section">
          <h2 className="text-lg font-semibold text-[#1f2735]">Booking Services</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Teacher Name</th>
                  <th className="px-3 py-2">Capacity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedClasses.items.map((item) => (
                  <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2">{item.categoryName}</td>
                    <td className="px-3 py-2">{item.defaultTeacherName ?? "\u2014"}</td>
                    <td className="px-3 py-2">{item.defaultCapacity}</td>
                    <td className="px-3 py-2">{item.isActive && item.isVisible ? "Active" : "Hidden"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/classes/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paginatedClasses.totalPages > 1 ? (
              <div className="flex items-center justify-end gap-3 border-t border-[#e2e8f0] px-3 py-2 text-sm text-[#4b5a72]" data-testid="booking-courses-pagination">
                {paginatedClasses.page > 1 ? (
                  <Link
                    href={buildPageHref({
                      categoryPage: paginatedCategories.page,
                      coursePage: paginatedClasses.page,
                      nextCoursePage: paginatedClasses.page - 1,
                    })}
                    className="text-[#2a4f78] underline underline-offset-4"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="text-[#94a3b8]">Previous</span>
                )}
                <span>{`Page ${paginatedClasses.page} of ${paginatedClasses.totalPages}`}</span>
                {paginatedClasses.page < paginatedClasses.totalPages ? (
                  <Link
                    href={buildPageHref({
                      categoryPage: paginatedCategories.page,
                      coursePage: paginatedClasses.page,
                      nextCoursePage: paginatedClasses.page + 1,
                    })}
                    className="text-[#2a4f78] underline underline-offset-4"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="text-[#94a3b8]">Next</span>
                )}
              </div>
            ) : null}
          </div>
        </section>
      )}
    </section>
  );
}

