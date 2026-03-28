import Link from "next/link";

import { uploadAgendaPdfAction, updateClientMessageStatusAction } from "@/app/admin/(private)/actions";
import { getAdminDashboardData } from "@/lib/admin/admin-service";
import { listClientMessages } from "@/lib/client-messages/client-message-service";
import { getActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminDashboardPage() {
  try {
    const [data, messages, agendaPdf] = await Promise.all([
      getAdminDashboardData(),
      listClientMessages({ limit: 12 }),
      getActiveAgendaPdfDocument(),
    ]);

    return (
      <section className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Dashboard</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Operational summary for the studio.</p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Upcoming Sessions</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.upcomingSessionsCount}</p>
          </article>

          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Bookings</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.bookingsCount}</p>
          </article>

          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Active Contracts</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.activePlansCount}</p>
          </article>

          <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Active Entitlements</p>
            <p className="mt-2 text-3xl font-semibold text-[#1f2735]">{data.activeEntitlementsCount}</p>
          </article>
        </div>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#1f2735]">Recent Bookings</h2>
            <Link href="/admin/bookings" className="text-sm text-[#2a4f78] underline underline-offset-4">
              View all bookings
            </Link>
          </div>

          {data.recentBookings.length === 0 ? (
            <p className="mt-3 text-sm text-[#4b5a72]">No bookings yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.recentBookings.map((booking) => (
                <li key={booking.id} className="rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#334155]">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">{booking.sessionTitle}</span>
                    <span className="text-xs uppercase tracking-wide">{booking.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#5a6d86]">
                    {booking.clientName} ({booking.clientEmail}) · {formatDateTime(booking.startsAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Agenda PDF</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Upload or replace the public agenda PDF.</p>
          <p className="mt-2 text-xs text-[#5a6d86]">Current file: {agendaPdf ? agendaPdf.fileUrl : "No active agenda PDF."}</p>
          <form action={uploadAgendaPdfAction} className="mt-3 flex flex-wrap items-end gap-3">
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
          <h2 className="text-lg font-semibold text-[#1f2735]">Client Messages</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">Unified inbox for contact and booking note messages.</p>
          {messages.length === 0 ? (
            <p className="mt-3 text-sm text-[#4b5a72]">No client messages yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {messages.map((message) => (
                <li key={message.id} className="rounded-md border border-[#e2e8f0] p-3 text-sm text-[#334155]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {message.type} - {message.name} ({message.email})
                    </p>
                    <form action={updateClientMessageStatusAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={message.id} />
                      <select name="status" defaultValue={message.status} className="rounded-md border border-[#d3dbe5] bg-white px-2 py-1 text-xs">
                        <option value="NEW">NEW</option>
                        <option value="READ">READ</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                      </select>
                      <button type="submit" className="rounded-md border border-[#d3dbe5] px-2 py-1 text-xs text-[#1f2735] hover:bg-[#f3f6fb]">
                        Update
                      </button>
                    </form>
                  </div>
                  {message.bookingId ? <p className="mt-1 text-xs text-[#5a6d86]">Booking ID: {message.bookingId}</p> : null}
                  {message.phone ? <p className="mt-1 text-xs text-[#5a6d86]">Phone: {message.phone}</p> : null}
                  {message.subject ? <p className="mt-1 text-xs text-[#5a6d86]">Subject: {message.subject}</p> : null}
                  <p className="mt-2">{message.message}</p>
                  <p className="mt-2 text-xs text-[#5a6d86]">{formatDateTime(message.createdAt.toISOString())}</p>
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
        <h1 className="text-2xl font-semibold text-[#1f2735]">Dashboard</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load dashboard data right now.</p>
      </section>
    );
  }
}
