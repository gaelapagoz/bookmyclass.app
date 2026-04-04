import Link from "next/link";

import { getAdminOnlineLearningData } from "@/lib/admin/admin-service";
export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminOnlineLearningPage() {
  try {
    const { programs, videos } = await getAdminOnlineLearningData();

    return (
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Online Learning</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage learning programs and videos from one place.</p>
        </header>

        <article className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#1f2735]">Programs</h2>
            <Link href="/admin/learning-programs/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
              Create program
            </Link>
          </div>

          {programs.length === 0 ? (
            <p className="text-sm text-[#4b5a72]">No learning programs found.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                  <tr>
                    <th className="px-3 py-2">Course Type</th>
                    <th className="px-3 py-2">Main Title</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {programs.map((item) => (
                    <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2">{item.courseType}</td>
                      <td className="px-3 py-2">{item.mainTitle}</td>
                      <td className="px-3 py-2">{item.title}</td>
                      <td className="px-3 py-2">{formatDate(item.updatedAt)}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/learning-programs/${item.id}/edit`}
                          className="text-[#2a4f78] underline underline-offset-4"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#1f2735]">Videos</h2>
            <Link href="/admin/learning-videos/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
              Create video
            </Link>
          </div>

          {videos.length === 0 ? (
            <p className="text-sm text-[#4b5a72]">No learning videos found.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Type/Level</th>
                    <th className="px-3 py-2">Priority</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((item) => (
                    <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2">{item.title}</td>
                      <td className="px-3 py-2">{item.category}</td>
                      <td className="px-3 py-2">
                        {item.categoryType ?? "-"} / {item.categoryLevel ?? "-"}
                      </td>
                      <td className="px-3 py-2">{item.priority}</td>
                      <td className="px-3 py-2">{formatDate(item.updatedAt)}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/learning-videos/${item.id}/edit`}
                          className="text-[#2a4f78] underline underline-offset-4"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Online Learning</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load online learning right now.</p>
      </section>
    );
  }
}
