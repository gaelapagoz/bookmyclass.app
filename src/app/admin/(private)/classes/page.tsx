import Link from "next/link";

import { getAdminClassesData } from "@/lib/admin/admin-service";

export default async function AdminClassesPage() {
  try {
    const classes = await getAdminClassesData();

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Classes</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage class/service definitions.</p>
          </div>
          <Link href="/admin/classes/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Create class
          </Link>
        </header>

        {classes.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No classes found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Slug</th>
                  <th className="px-3 py-2">Duration</th>
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
                    <td className="px-3 py-2">{item.slug}</td>
                    <td className="px-3 py-2">{item.defaultDurationMinutes} min</td>
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
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Classes</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load classes right now.</p>
      </section>
    );
  }
}

