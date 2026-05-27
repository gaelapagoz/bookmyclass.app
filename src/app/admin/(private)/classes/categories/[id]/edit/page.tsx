import Link from "next/link";
import { notFound } from "next/navigation";

import { updateClassCategoryAction } from "@/app/admin/(private)/actions";
import { getAdminClassCategoryById } from "@/lib/admin/admin-catalog-core-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  error?: string;
  categoryPage?: string;
  coursePage?: string;
}>;

export default async function AdminClassCategoryEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const category = await getAdminClassCategoryById(id);
  if (!category) {
    notFound();
  }

  const { error, categoryPage, coursePage } = await searchParams;
  const backQuery = new URLSearchParams();
  if (categoryPage) {
    backQuery.set("categoryPage", categoryPage);
  }
  if (coursePage) {
    backQuery.set("coursePage", coursePage);
  }
  const backHref = `/admin/classes${backQuery.toString() ? `?${backQuery.toString()}` : ""}`;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Category</h1>
        <Link href={backHref} className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to booking services
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateClassCategoryAction.bind(null, id)} className="max-w-2xl space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <input type="hidden" name="returnCategoryPage" value={categoryPage ?? ""} />
        <input type="hidden" name="returnCoursePage" value={coursePage ?? ""} />
        <label className="block text-sm text-[#334155]">
          Name
          <input
            name="name"
            required
            defaultValue={category.name}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>
        <label className="block text-sm text-[#334155]">
          Description
          <input
            name="description"
            defaultValue={category.description ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>
        <label className="block text-sm text-[#334155]">
          Sort
          <input
            name="sortOrder"
            type="number"
            min={0}
            required
            defaultValue={category.sortOrder}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" name="isActive" defaultChecked={category.isActive} /> Active
        </label>
        <div>
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Update category
          </button>
        </div>
      </form>
    </section>
  );
}
