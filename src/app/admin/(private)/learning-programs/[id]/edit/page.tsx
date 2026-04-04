import Link from "next/link";
import { notFound } from "next/navigation";

import { updateLearningProgramAction } from "@/app/admin/(private)/actions";
import { getAdminLearningProgramById } from "@/lib/admin/admin-service";

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
  const record = await getAdminLearningProgramById(id);

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
          <label className="block text-sm text-[#334155]">
            Picture1
            <input name="picture1" defaultValue={record.picture1 ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Picture2
            <input name="picture2" defaultValue={record.picture2 ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Picture3
            <input name="picture3" defaultValue={record.picture3 ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update learning program
        </button>
      </form>
    </section>
  );
}
