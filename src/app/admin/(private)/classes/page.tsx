import Link from "next/link";

import { createClassCategoryAction } from "@/app/admin/(private)/actions";
import { getAdminClassCategoriesData, getAdminClassesData } from "@/lib/admin/admin-service";

type SearchParams = Promise<{ error?: string; success?: string }>;

export default async function AdminClassesPage(
  { searchParams = Promise.resolve({}) }: { searchParams?: SearchParams } = {},
) {
  let classes: Awaited<ReturnType<typeof getAdminClassesData>> | null = null;
  let categories: Awaited<ReturnType<typeof getAdminClassCategoriesData>> | null = null;
  let loadFailed = false;
  const { error, success } = await searchParams;

  try {
    [classes, categories] = await Promise.all([getAdminClassesData(), getAdminClassCategoriesData()]);
  } catch {
    loadFailed = true;
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Booking Services</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage booking-service definitions.</p>
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
                  <th className="px-3 py-2">Slug</th>
                  <th className="px-3 py-2">Services</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">{category.name}</td>
                    <td className="px-3 py-2">{category.slug}</td>
                    <td className="px-3 py-2">{category.serviceCount}</td>
                    <td className="px-3 py-2">{category.isActive ? "Active" : "Hidden"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
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
              {classes.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">{item.categoryName}</td>
                  <td className="px-3 py-2">{item.defaultTeacherName ?? "—"}</td>
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
        </div>
      )}
    </section>
  );
}


