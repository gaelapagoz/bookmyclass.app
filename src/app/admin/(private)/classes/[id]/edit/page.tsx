import Link from "next/link";
import { notFound } from "next/navigation";

import { updateClassAction } from "@/app/admin/(private)/actions";
import { getAdminClassById, getClassCategoryOptions } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function AdminClassEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const [record, categories] = await Promise.all([getAdminClassById(id), getClassCategoryOptions()]);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Class</h1>
        <Link href="/admin/classes" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to classes
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateClassAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <label className="block text-sm text-[#334155]">
          Category
          <select
            name="categoryId"
            required
            defaultValue={record.categoryId}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          >
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
            <input
              name="name"
              required
              defaultValue={record.name}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Slug
            <input
              name="slug"
              required
              defaultValue={record.slug}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={record.description ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Default Duration (min)
            <input
              name="defaultDurationMinutes"
              type="number"
              min={1}
              required
              defaultValue={record.defaultDurationMinutes}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Default Capacity
            <input
              name="defaultCapacity"
              type="number"
              min={1}
              required
              defaultValue={record.defaultCapacity}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Sort Order
            <input
              name="sortOrder"
              type="number"
              min={0}
              required
              defaultValue={record.sortOrder}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-[#334155]">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="isActive" defaultChecked={record.isActive} /> Active
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="isVisible" defaultChecked={record.isVisible} /> Visible
          </label>
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update class
        </button>
      </form>
    </section>
  );
}
