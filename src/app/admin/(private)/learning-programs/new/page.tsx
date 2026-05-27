import Link from "next/link";

import { createLearningProgramAction } from "@/app/admin/(private)/actions";
import { getLearningMediaLibraryOptions } from "@/lib/admin/admin-catalog-core-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminLearningProgramCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const mediaLibrary = await getLearningMediaLibraryOptions();

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create Learning Program</h1>
        <Link href="/admin/learning-programs" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to learning programs
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={createLearningProgramAction} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Course Type
            <input name="courseType" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Main Description
          <textarea name="mainDescription" rows={3} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Description1
            <input name="description1" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Description2
            <input name="description2" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Description3
            <input name="description3" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Video Promo URL
            <input name="videoPromo" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          {(["picture1", "picture2", "picture3"] as const).map((field) => (
            <fieldset key={field} className="space-y-2 text-sm text-[#334155]">
              <legend className="font-medium">{field}</legend>
              <select name={field} className="w-full rounded-md border border-[#d3dbe5] px-3 py-2">
                <option value="">No library image</option>
                {mediaLibrary.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                name={`${field}Upload`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </fieldset>
          ))}
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Save learning program
        </button>
      </form>
    </section>
  );
}

