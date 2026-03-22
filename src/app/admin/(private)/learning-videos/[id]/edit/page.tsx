import Link from "next/link";
import { notFound } from "next/navigation";

import { updateLearningVideoAction } from "@/app/admin/(private)/actions";
import { getAdminLearningVideoById } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function AdminLearningVideoEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const record = await getAdminLearningVideoById(id);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Learning Video</h1>
        <Link href="/admin/learning-videos" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to learning videos
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateLearningVideoAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Legacy ID
            <input
              name="legacyId"
              required
              defaultValue={record.legacyId}
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
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={record.description ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#334155]">
          Short Description
          <input
            name="shortDescription"
            defaultValue={record.shortDescription ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Category
            <input
              name="category"
              required
              defaultValue={record.category}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Category Type
            <input
              name="categoryType"
              defaultValue={record.categoryType ?? ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Category Level
            <input
              name="categoryLevel"
              defaultValue={record.categoryLevel ?? ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Thumbnail URL
            <input
              name="thumbnail"
              defaultValue={record.thumbnail ?? ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Video URL
            <input
              name="videoUrl"
              defaultValue={record.videoUrl ?? ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Priority
            <input
              name="priority"
              type="number"
              defaultValue={record.priority}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update learning video
        </button>
      </form>
    </section>
  );
}
