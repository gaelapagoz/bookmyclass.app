import Link from "next/link";

import { createLearningVideoAction } from "@/app/admin/(private)/actions";
import { getAdminLearningProgramCourseTypeOptions } from "@/lib/admin/admin-catalog-core-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminLearningVideoCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const courseTypeOptions = await getAdminLearningProgramCourseTypeOptions();

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create Learning Video</h1>
        <Link href="/admin/learning-videos" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to learning videos
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={createLearningVideoAction} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Title
            <input name="title" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea name="description" rows={3} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <label className="block text-sm text-[#334155]">
          Short Description
          <input name="shortDescription" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <div className="grid gap-3 md:grid-cols-1">
          <label className="block text-sm text-[#334155]">
            Course Type
            <select name="category" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              {courseTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Thumbnail Path
            <input
              name="thumbnail"
              placeholder="/uploads/learning/example.jpg"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Video URL
            <input name="videoUrl" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Priority
            <input
              name="priority"
              type="number"
              defaultValue={0}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Save learning video
        </button>
      </form>
    </section>
  );
}


