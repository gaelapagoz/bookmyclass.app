import Link from "next/link";

import { getAdminLearningProgramsData } from "@/lib/admin/admin-service";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminLearningProgramsPage() {
  try {
    const programs = await getAdminLearningProgramsData();

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Learning Programs</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage online learning program metadata.</p>
          </div>
          <Link href="/admin/learning-programs/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Create program
          </Link>
        </header>

        {programs.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No learning programs found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Legacy ID</th>
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
                    <td className="px-3 py-2 font-medium">{item.legacyId}</td>
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
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Learning Programs</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load learning programs right now.</p>
      </section>
    );
  }
}
