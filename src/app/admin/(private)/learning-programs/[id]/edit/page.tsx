import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { updateLearningProgramAction } from "@/app/admin/(private)/actions";
import { getAdminLearningProgramById, getLearningMediaLibraryOptions } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

function getVideoPreviewSource(videoPromo: string | null): { type: "iframe" | "video"; src: string } | null {
  const raw = videoPromo?.trim();
  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase();
  if (lower.endsWith(".mp4")) {
    return { type: "video", src: raw };
  }

  const youtubeWatchMatch = raw.match(/[?&]v=([^&]+)/);
  if (raw.includes("youtube.com/watch") && youtubeWatchMatch?.[1]) {
    return { type: "iframe", src: `https://www.youtube.com/embed/${youtubeWatchMatch[1]}` };
  }

  const youtubeShortMatch = raw.match(/youtu\.be\/([^?&/]+)/);
  if (youtubeShortMatch?.[1]) {
    return { type: "iframe", src: `https://www.youtube.com/embed/${youtubeShortMatch[1]}` };
  }

  const vimeoMatch = raw.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch?.[1]) {
    return { type: "iframe", src: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  }

  return null;
}

function getFileName(path: string | null): string {
  if (!path) {
    return "No file selected";
  }
  return path.split("/").at(-1) ?? path;
}

function getPicturePreviewTestId(index: string): string {
  if (index === "1") {
    return "learning-program-picture-1-preview";
  }
  if (index === "2") {
    return "learning-program-picture-2-preview";
  }
  return "learning-program-picture-3-preview";
}

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
  const videoPreview = getVideoPreviewSource(record.videoPromo);
  const courseTypeValue = record.courseType.trim();

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Learning Program</h1>
        <Link href="/admin/learning-programs" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to learning programs
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <div className="mx-auto max-w-5xl rounded-2xl border border-[#d3dbe5] bg-white p-6 md:p-7">
        <form
          action={updateLearningProgramAction.bind(null, id)}
          data-testid="admin-learning-program-edit-form"
          className="space-y-5"
        >
          <label className="block text-sm text-[#334155]">
            Course Type
            <input
              name="courseType"
              data-testid="learning-program-course-type"
              required
              defaultValue={courseTypeValue}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Main Description
            <textarea
              name="mainDescription"
              data-testid="learning-program-main-description"
              rows={5}
              defaultValue={record.mainDescription ?? ""}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Description 1
            <textarea
              name="description1"
              data-testid="learning-program-description-1"
              rows={4}
              defaultValue={record.description1 ?? ""}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Description 2
            <textarea
              name="description2"
              data-testid="learning-program-description-2"
              rows={4}
              defaultValue={record.description2 ?? ""}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Description 3
            <textarea
              name="description3"
              data-testid="learning-program-description-3"
              rows={4}
              defaultValue={record.description3 ?? ""}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm text-[#334155]">
              Video Promo URL
              <input
                name="videoPromo"
                data-testid="learning-program-video-url"
                defaultValue={record.videoPromo ?? ""}
                className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
              />
              <p className="mt-1 text-xs text-[#64748b]">YouTube, Vimeo, or direct mp4. Preview updates automatically.</p>
            </label>
            <div
              data-testid="learning-program-video-preview"
              className="rounded-lg border border-[#d3dbe5] bg-[#f8fafc] p-2"
            >
              {videoPreview?.type === "iframe" ? (
                <iframe
                  title="Video promo preview"
                  src={videoPreview.src}
                  className="aspect-video w-full rounded-md"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : null}
              {videoPreview?.type === "video" ? (
                <video className="aspect-video w-full rounded-md" controls src={videoPreview.src}>
                  <track kind="captions" />
                </video>
              ) : null}
              {!videoPreview ? <p className="text-sm text-[#64748b]">No preview available</p> : null}
            </div>
          </div>

          {(["picture1", "picture2", "picture3"] as const).map((field) => {
            const current = record[field];
            const options = current && !mediaLibrary.some((item) => item.path === current)
              ? [{ path: current, name: current.split("/").at(-1) ?? current }, ...mediaLibrary]
              : mediaLibrary;
            const index = field.replace("picture", "");

            return (
              <fieldset key={field} data-testid={`learning-program-picture-${index}`} className="space-y-2 text-sm text-[#334155]">
                <legend className="font-medium">Picture {index}</legend>
                <p className="text-xs text-[#64748b]">Current file: {getFileName(current)}</p>
                <div
                  data-testid={getPicturePreviewTestId(index)}
                  className="relative aspect-video w-full overflow-hidden rounded-lg border border-[#d3dbe5] bg-[#f8fafc]"
                >
                  {current ? (
                    <Image
                      src={current}
                      alt={`Picture ${index} preview`}
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center text-xs text-[#64748b]">
                      No image selected
                    </div>
                  )}
                </div>
                <select name={field} defaultValue={current ?? ""} className="w-full rounded-lg border border-[#d3dbe5] px-3 py-2">
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
                  className="w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
                />
                <p className="text-xs text-[#64748b]">
                  {"Recommended 1600\u00D7900 \u00B7 JPG or PNG \u00B7 < 2 MB"}
                </p>
              </fieldset>
            );
          })}

          <button
            type="submit"
            data-testid="learning-program-update-submit"
            className="rounded-lg bg-[#1d3652] px-4 py-2 text-sm text-white"
          >
            Update learning program
          </button>
        </form>
      </div>
    </section>
  );
}


