import Link from "next/link";

import { createLearningProgramAction } from "@/app/admin/(private)/actions";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminLearningProgramCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

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

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Main Title
            <input name="mainTitle" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Title
            <input name="title" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
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
          <label className="block text-sm text-[#334155]">
            Picture1
            <input
              name="picture1"
              placeholder="/images/learning/example.jpg"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Picture2
            <input
              name="picture2"
              placeholder="/images/learning/example.jpg"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Picture3
            <input
              name="picture3"
              placeholder="/images/learning/example.jpg"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Save learning program
        </button>
      </form>
    </section>
  );
}
