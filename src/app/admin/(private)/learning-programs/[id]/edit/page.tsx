import Link from "next/link";
import { notFound } from "next/navigation";

import { updateLearningProgramAction } from "@/app/admin/(private)/actions";
import { getAdminLearningProgramById, getLearningMediaLibraryOptions } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function AdminLearningProgramEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const [record, mediaLibrary] = await Promise.all([getAdminLearningProgramById(id), getLearningMediaLibraryOptions()]);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Learning Program</h1>
        <Link href="/admin/learning-programs" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to learning programs
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateLearningProgramAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Course Type
            <input
              name="courseType"
              required
              defaultValue={record.courseType}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Main Title
            <input
              name="mainTitle"
              required
              defaultValue={record.mainTitle}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Title
            <input
              name="title"
              required
              defaultValue={record.title}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Main Description
          <textarea
            name="mainDescription"
            rows={3}
            defaultValue={record.mainDescription ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Description1
            <input name="description1" defaultValue={record.description1 ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Description2
            <input name="description2" defaultValue={record.description2 ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Description3
            <input name="description3" defaultValue={record.description3 ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Video Promo URL
            <input name="videoPromo" defaultValue={record.videoPromo ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          {(["picture1", "picture2", "picture3"] as const).map((field) => {
            const current = record[field];
            const options = current && !mediaLibrary.some((item) => item.path === current)
              ? [{ path: current, name: current.split("/").at(-1) ?? current }, ...mediaLibrary]
              : mediaLibrary;

            return (
              <fieldset key={field} className="space-y-2 text-sm text-[#334155]">
                <legend className="font-medium">{field}</legend>
                <select name={field} defaultValue={current ?? ""} className="w-full rounded-md border border-[#d3dbe5] px-3 py-2">
                  <option value="">No library image</option>
                  {options.map((item) => (
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
            );
          })}
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update learning program
        </button>
      </form>
    </section>
  );
}
