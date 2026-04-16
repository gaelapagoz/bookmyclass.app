import { AttendanceStatus } from "@prisma/client";
import { getStaffAttendanceTransitionAvailability } from "@/lib/attendance/attendance-transitions";

type StaffAttendanceAction = (formData: FormData) => void | Promise<void>;

function AttendanceButtonForm(props: {
  bookingId: string;
  targetStatus: "CHECKED_IN" | "ATTENDED" | "NO_SHOW" | "CLEAR";
  label: string;
  action: StaffAttendanceAction;
  destructive?: boolean;
}) {
  return (
    <form action={props.action}>
      <input type="hidden" name="bookingId" value={props.bookingId} />
      <input type="hidden" name="targetStatus" value={props.targetStatus} />
      <button
        type="submit"
        className={
          props.destructive
            ? "rounded-md border border-[#ba3f3f] px-2 py-1 text-xs text-[#ba3f3f]"
            : "rounded-md border border-[#cbd5e1] px-2 py-1 text-xs text-[#1f2735]"
        }
      >
        {props.label}
      </button>
    </form>
  );
}

export function StaffAttendanceControls(props: {
  bookingId: string;
  attendanceStatus: AttendanceStatus | null;
  action: StaffAttendanceAction;
}) {
  const availability = getStaffAttendanceTransitionAvailability(props.attendanceStatus);

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-[#334155]">Attendance actions</p>
      <div className="flex flex-wrap items-center gap-2">
        {availability.canMarkCheckedIn ? (
          <AttendanceButtonForm
            bookingId={props.bookingId}
            targetStatus="CHECKED_IN"
            label="Mark checked in"
            action={props.action}
          />
        ) : null}
        {availability.canMarkAttended ? (
          <AttendanceButtonForm
            bookingId={props.bookingId}
            targetStatus="ATTENDED"
            label="Mark attended"
            action={props.action}
          />
        ) : null}
        {availability.canMarkNoShow ? (
          <AttendanceButtonForm
            bookingId={props.bookingId}
            targetStatus="NO_SHOW"
            label="Mark no-show"
            action={props.action}
          />
        ) : null}
        {availability.canClearCheckedIn ? (
          <AttendanceButtonForm
            bookingId={props.bookingId}
            targetStatus="CLEAR"
            label="Undo check-in"
            action={props.action}
            destructive
          />
        ) : null}
      </div>
    </div>
  );
}
