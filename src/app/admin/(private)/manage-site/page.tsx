import Link from "next/link";

import { uploadAgendaPdfAction } from "@/app/admin/(private)/actions";
import { getActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";
import {
  getHomeAgendaTableFromSchedule,
  getManageSiteAgendaPreview,
} from "@/lib/public-content/home-agenda-service";

type SearchParams = Promise<{ error?: string }>;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminManageSitePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  try {
    const [agendaPdf, agendaTable, upcomingPreview] = await Promise.all([
      getActiveAgendaPdfDocument(),
      getHomeAgendaTableFromSchedule(),
      getManageSiteAgendaPreview(),
    ]);

    return (
      <section className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Manage Site</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage public website assets and schedule-backed homepage agenda.</p>
        </header>

        {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Agenda PDF</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Upload or replace the public agenda PDF download.</p>
          <p className="mt-2 text-xs text-[#5a6d86]">Current file: {agendaPdf ? agendaPdf.fileUrl : "No active agenda PDF."}</p>
          <form action={uploadAgendaPdfAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="returnTo" value="/admin/manage-site" />
            <label className="text-sm text-[#334155]">
              PDF file
              <input
                type="file"
                name="agendaPdf"
                accept="application/pdf"
                required
                className="mt-1 block rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm"
              />
            </label>
            <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white hover:opacity-90">
              Upload
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Home Agenda Table</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">
            The homepage agenda table is derived from published scheduled sessions for the current week.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/sessions" className="rounded-md border border-[#d3dbe5] px-3 py-1.5 text-sm text-[#1f2735] hover:bg-[#f3f6fb]">
              Manage sessions
            </Link>
            <Link href="/admin/classes" className="rounded-md border border-[#d3dbe5] px-3 py-1.5 text-sm text-[#1f2735] hover:bg-[#f3f6fb]">
              Manage classes
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-[#e2e8f0]">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Classes</th>
                </tr>
              </thead>
              <tbody>
                {agendaTable.map((entry) => (
                  <tr key={entry.day} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">{entry.day}</td>
                    <td className="px-3 py-2">{entry.classes.length > 0 ? entry.classes.join(" | ") : "No classes"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-[#5a6d86]">Upcoming published sessions</h3>
          {upcomingPreview.length === 0 ? (
            <p className="mt-2 text-sm text-[#4b5a72]">No upcoming sessions available.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {upcomingPreview.map((session) => (
                <li key={session.id} className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#334155]">
                  <p className="font-medium">{session.title}</p>
                  <p className="text-xs text-[#5a6d86]">
                    {formatDateTime(session.startsAt)} - {formatDateTime(session.endsAt)}
                  </p>
                  <p className="text-xs text-[#5a6d86]">
                    {session.bookedSpots}/{session.capacity} booked
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Manage Site</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load site management data right now.</p>
      </section>
    );
  }
}
