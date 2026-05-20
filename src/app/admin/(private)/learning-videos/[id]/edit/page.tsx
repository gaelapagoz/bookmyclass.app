import Link from "next/link";
import { notFound } from "next/navigation";

import { updateLearningVideoAction } from "@/app/admin/(private)/actions";
import { getAdminLearningProgramCourseTypeOptions, getAdminLearningVideoById } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

function getVideoPreviewSource(videoUrl: string | null): { type: "iframe" | "video"; src: string } | null {
  const raw = videoUrl?.trim();
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

export default async function AdminLearningVideoEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const [record, programCourseTypes] = await Promise.all([
    getAdminLearningVideoById(id),
    getAdminLearningProgramCourseTypeOptions(),
  ]);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;
  const videoPreview = getVideoPreviewSource(record.videoUrl);
  const courseTypeOptions = programCourseTypes.includes(record.category)
    ? programCourseTypes
    : [record.category, ...programCourseTypes];

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Learning Video</h1>
        <Link href="/admin/learning-videos" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to learning videos
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <div className="mx-auto max-w-6xl rounded-2xl border border-[#d3dbe5] bg-white p-6 md:p-7">
        <form
          action={updateLearningVideoAction.bind(null, id)}
          data-testid="admin-learning-video-edit-form"
          className="space-y-5"
        >
          <label className="block text-sm text-[#334155]">
            Title
            <input
              name="title"
              data-testid="learning-video-title"
              required
              defaultValue={record.title}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Description
            <textarea
              name="description"
              data-testid="learning-video-description"
              rows={6}
              defaultValue={record.description ?? ""}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Short Description
            <input
              name="shortDescription"
              data-testid="learning-video-short-description"
              defaultValue={record.shortDescription ?? ""}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
            <p className="mt-1 text-xs text-[#64748b]">One-line summary used in lists, cards, and previews.</p>
          </label>

          <div className="grid gap-3 md:grid-cols-1">
            <label className="block text-sm text-[#334155]">
              Course Type
              <select
                name="category"
                data-testid="learning-video-course-type"
                required
                defaultValue={record.category}
                className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
              >
                {courseTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <label className="block text-sm text-[#334155]">
                Thumbnail
                <p className="mt-1 text-xs text-[#64748b]">Current file: {getFileName(record.thumbnail)}</p>
                <input
                  name="thumbnailUpload"
                  data-testid="learning-video-thumbnail-upload"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="mt-2 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
                />
                <p className="mt-1 text-xs text-[#64748b]">{"Recommended 1600\u00D7900 \u00B7 JPG or PNG \u00B7 < 2 MB"}</p>
              </label>
            </div>

            <div className="space-y-4">
              <div data-testid="learning-video-thumbnail-preview" className="rounded-lg border border-[#d3dbe5] bg-[#f8fafc] p-2">
                {record.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={record.thumbnail} alt="Current thumbnail preview" className="aspect-video w-full rounded-md object-cover" />
                ) : (
                  <p className="text-sm text-[#64748b]">No thumbnail preview available</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-[#d3dbe5]" />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <label className="block text-sm text-[#334155]">
                Video URL
                <input
                  name="videoUrl"
                  data-testid="learning-video-video-url"
                  defaultValue={record.videoUrl ?? ""}
                  className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
                />
                <p className="mt-1 text-xs text-[#64748b]">YouTube, Vimeo, or direct mp4. Thumbnail auto-loads for YouTube links.</p>
              </label>
            </div>

            <div className="space-y-4">
              <div data-testid="learning-video-video-preview" className="rounded-lg border border-[#d3dbe5] bg-[#f8fafc] p-2">
                {videoPreview?.type === "iframe" ? (
                  <iframe
                    title="Learning video preview"
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
                {!videoPreview ? <p className="text-sm text-[#64748b]">No video preview available</p> : null}
              </div>
            </div>
          </div>

          <div className="border-t border-[#d3dbe5]" />

          <label className="block text-sm text-[#334155]">
            Priority
            <input
              name="priority"
              data-testid="learning-video-priority"
              type="number"
              defaultValue={record.priority}
              className="mt-1 w-full rounded-lg border border-[#d3dbe5] px-3 py-2"
            />
            <p className="mt-1 text-xs text-[#64748b]">Lower numbers appear first in the list.</p>
          </label>

          <div className="flex items-center gap-3 border-t border-[#d3dbe5] pt-4">
            <button
              type="submit"
              data-testid="learning-video-update-submit"
              className="rounded-lg bg-[#1d3652] px-4 py-2 text-sm text-white"
            >
              Update learning video
            </button>
            <Link
              href="/admin/learning-videos"
              className="rounded-lg border border-[#d3dbe5] px-4 py-2 text-sm text-[#334155]"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
