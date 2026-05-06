import Link from "next/link";

import { createClassAction } from "@/app/admin/(private)/actions";
import ClassScheduleFields from "@/components/admin/ClassScheduleFields";
import { getAdminClassScheduleOptions, getClassCategoryOptions } from "@/lib/admin/admin-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminClassCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const [categories, teachers] = await Promise.all([getClassCategoryOptions(), getAdminClassScheduleOptions()]);
  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create Booking Service</h1>
        <Link href="/admin/classes" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to booking services
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={createClassAction} className="space-y-3">
        <section className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <label className="block text-sm text-[#334155]">
          Category
          <select name="categoryId" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Name
            <input name="name" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Service Image
            <input
              name="classImage"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea name="description" rows={3} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Default Duration (min)
            <input
              name="defaultDurationMinutes"
              type="number"
              min={1}
              defaultValue={60}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Default Capacity
            <input
              name="defaultCapacity"
              type="number"
              min={1}
              defaultValue={10}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Sort Order
            <input
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={0}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-[#334155]">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="isActive" defaultChecked /> Active
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="isVisible" defaultChecked /> Visible
          </label>
        </div>

        </section>
        <ClassScheduleFields teachers={teachers} />
        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Save class
        </button>
      </form>
    </section>
  );
}

