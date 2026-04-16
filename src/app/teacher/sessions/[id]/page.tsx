import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addTeacherSessionAttendeeAction,
  removeTeacherSessionAttendeeAction,
  updateTeacherSessionAttendanceAction,
} from "@/app/teacher/actions";
import { StaffAttendanceControls } from "@/components/attendance/StaffAttendanceControls";
import { requireTeacherSession } from "@/lib/auth/require-auth";
import { getTeacherSessionRosterData } from "@/lib/teacher/teacher-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; success?: string }>;

export default async function TeacherSessionRosterPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await requireTeacherSession({
    callbackUrl: "/teacher/sessions",
    unauthorizedPath: "/dashboard",
  });
  const { id } = await params;
  const { error, success } = await searchParams;

  let rosterData: Awaited<ReturnType<typeof getTeacherSessionRosterData>>;
  try {
    rosterData = await getTeacherSessionRosterData({
      teacherUserId: session.user.id,
      sessionId: id,
    });
  } catch (serviceError) {
    if (serviceError instanceof Error && serviceError.message === "TEACHER_SESSION_FORBIDDEN") {
      redirect(`/teacher/sessions?error=${encodeURIComponent("You can access only your assigned sessions.")}`);
      return null;
    }
    throw serviceError;
  }

  if (!rosterData) {
    redirect(`/teacher/sessions?error=${encodeURIComponent("Session not found.")}`);
    return null;
  }

  const { session: sessionRecord, clients } = rosterData;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">{sessionRecord.title}</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">
            {new Date(sessionRecord.startsAt).toLocaleString()} - {new Date(sessionRecord.endsAt).toLocaleString()}
          </p>
        </div>
        <Link href="/teacher/sessions" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to sessions
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#1d5c34]">{success}</p> : null}

      <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5" data-testid="teacher-session-roster">
        <header>
          <h2 className="text-lg font-semibold text-[#1f2735]">Class Roster</h2>
          <p className="text-sm text-[#4a5b73]">You can manage clients only for this assigned session.</p>
        </header>

        {sessionRecord.attendees.length > 0 ? (
          <ul className="space-y-3">
            {sessionRecord.attendees.map((attendee) => (
              <li
                key={attendee.bookingId}
                data-testid={`teacher-attendee-${attendee.bookingId}`}
                className="rounded-md border border-[#d3dbe5] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#1f2735]">{attendee.clientName}</p>
                    <p className="text-xs text-[#4a5b73]">{attendee.clientEmail}</p>
                    <p className="mt-1 text-xs text-[#1f2735]">
                      Attendance: {attendee.attendanceStatus ?? "NOT_MARKED"}
                    </p>
                    {attendee.attendanceStatus ? (
                      <p className="text-xs text-[#4a5b73]">
                        Source: {attendee.attendanceSource ?? "N/A"}
                        {attendee.checkedInAt && ` | Marked at ${new Date(attendee.checkedInAt).toLocaleString()}`}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-[#4a5b73]">Status: {attendee.status}</p>
                </div>
                <StaffAttendanceControls
                  bookingId={attendee.bookingId}
                  attendanceStatus={attendee.attendanceStatus}
                  action={updateTeacherSessionAttendanceAction.bind(null, sessionRecord.id)}
                />
                <form action={removeTeacherSessionAttendeeAction.bind(null, sessionRecord.id)} className="mt-3 space-y-2">
                  <input type="hidden" name="bookingId" value={attendee.bookingId} />
                  <label className="block text-xs text-[#334155]">
                    Removal note (optional)
                    <input name="note" maxLength={400} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
                  </label>
                  <button type="submit" className="rounded-md border border-[#ba3f3f] px-3 py-2 text-xs text-[#ba3f3f]">
                    Remove client
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#4a5b73]">No clients booked yet.</p>
        )}

        <form action={addTeacherSessionAttendeeAction.bind(null, sessionRecord.id)} className="space-y-2 rounded-md border border-[#d3dbe5] p-3">
          <h3 className="text-sm font-semibold text-[#1f2735]">Add client</h3>
          <label className="block text-sm text-[#334155]">
            Client
            <select name="clientId" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="">Select a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.email}) -{" "}
                  {client.hasAvailableCredits ? `${client.availableCredits} credits available` : "No eligible credits"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#334155]">
            Note
            <textarea
              name="note"
              rows={2}
              maxLength={400}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Add client
          </button>
        </form>
      </section>
    </section>
  );
}
