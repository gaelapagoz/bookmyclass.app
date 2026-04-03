import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import {
  addSessionAttendeeAction,
  removeSessionAttendeeAction,
  updateSessionAction,
} from "@/app/admin/(private)/actions";
import { getAdminSessionById, getAdminSessionOptions } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; success?: string }>;

function toDateTimeLocal(value: Date): string {
  const iso = new Date(value).toISOString();
  return iso.slice(0, 16);
}

export default async function AdminSessionEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  noStore();

  const { id } = await params;
  const [record, options] = await Promise.all([getAdminSessionById(id), getAdminSessionOptions(id)]);

  if (!record) {
    notFound();
  }

  const { error, success } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Calendar Session</h1>
        <Link href="/admin/sessions" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to calendar
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#1d5c34]">{success}</p> : null}

      <form action={updateSessionAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Class Template
            <select
              name="classTemplateId"
              required
              defaultValue={record.classTemplateId}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              {options.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-[#334155]">
            Teacher
            <select
              name="teacherId"
              required
              defaultValue={record.teacherId}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              {options.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Title
          <input
            name="title"
            required
            defaultValue={record.title}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

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
          Location
          <input
            name="location"
            defaultValue={record.location ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Starts At
            <input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={toDateTimeLocal(record.startsAt)}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Ends At
            <input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={toDateTimeLocal(record.endsAt)}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Capacity
            <input
              name="capacity"
              type="number"
              min={1}
              required
              defaultValue={record.capacity}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Status
          <select
            name="status"
            defaultValue={record.status}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          >
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </label>

        <div className="pt-2" data-testid="published-row">
          <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" name="isPublished" defaultChecked={record.isPublished} /> Published
          </label>
        </div>

        <div className="pt-2" data-testid="session-update-actions">
          <button
            type="submit"
            className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white"
            data-testid="session-update-button"
          >
            Update session
          </button>
        </div>
      </form>

      <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5" data-testid="session-attendees-section">
        <header>
          <h2 className="text-lg font-semibold text-[#1f2735]">Attendees</h2>
          <p className="text-sm text-[#4a5b73]">Manage booked clients for this session.</p>
        </header>

        {record.attendees.length > 0 ? (
          <ul className="space-y-3">
            {record.attendees.map((attendee) => (
              <li key={attendee.bookingId} className="rounded-md border border-[#d3dbe5] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#1f2735]">{attendee.clientName}</p>
                    <p className="text-xs text-[#4a5b73]">{attendee.clientEmail}</p>
                  </div>
                  <p className="text-xs text-[#4a5b73]">Status: {attendee.status}</p>
                </div>
                <form action={removeSessionAttendeeAction.bind(null, id)} className="mt-3 space-y-2">
                  <input type="hidden" name="bookingId" value={attendee.bookingId} />
                  <label className="block text-xs text-[#334155]">
                    Removal note (optional)
                    <input name="note" maxLength={400} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
                  </label>
                  <button type="submit" className="rounded-md border border-[#ba3f3f] px-3 py-2 text-xs text-[#ba3f3f]">
                    Remove attendee
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#4a5b73]">No attendees booked yet.</p>
        )}

        <form action={addSessionAttendeeAction.bind(null, id)} className="space-y-2 rounded-md border border-[#d3dbe5] p-3">
          <h3 className="text-sm font-semibold text-[#1f2735]">Add attendee</h3>
          <label className="block text-sm text-[#334155]">
            Client
            <select name="clientId" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="">Select a client</option>
              {options.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.email}) -{" "}
                  {client.hasAvailableCredits ? `${client.availableCredits} credits available` : "No credits available"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#334155]">
            Note (required when no credits are available)
            <textarea
              name="note"
              rows={2}
              maxLength={400}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Add attendee
          </button>
        </form>
      </section>
    </section>
  );
}

