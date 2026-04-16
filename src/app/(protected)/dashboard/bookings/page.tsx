import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  cancelClientBooking,
  DashboardBookingItem,
  DashboardServiceError,
  getDashboardBookingsData,
} from "@/lib/dashboard/dashboard-service";
import { checkInBooking } from "@/lib/attendance/attendance-service";
import { AttendanceSource } from "@prisma/client";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

type SearchParams = Promise<{
  error?: string;
  cancelled?: string;
  checked_in?: string;
}>;

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function renderBookingCard(booking: DashboardBookingItem, showCancel: boolean) {
  return (
    <li
      key={booking.bookingId}
      data-testid={`dashboard-booking-${booking.bookingId}`}
      className="rounded-md border border-[#ebe1d8] bg-white p-3"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-[#6f2b2b]">{booking.serviceTitle}</p>
        <p className="text-xs uppercase tracking-wide text-[#8a5959]">{booking.status}</p>
      </div>
      <p className="mt-1 text-sm text-[#5f4040]">{formatDateTime(booking.startsAt)}</p>
      {booking.location ? <p className="text-sm text-[#5f4040]">{booking.location}</p> : null}
      {booking.isCheckedIn && (
        <p
          data-testid={`dashboard-checked-in-${booking.bookingId}`}
          className="mt-1 text-xs font-medium text-green-600"
        >
          Checked in
        </p>
      )}
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          {booking.canCheckIn && !booking.isCheckedIn && (
            <form action={checkInBookingAction}>
              <input type="hidden" name="bookingId" value={booking.bookingId} />
              <button
                type="submit"
                data-testid={`dashboard-check-in-${booking.bookingId}`}
                className="rounded-md bg-[#7b2d2d] px-3 py-1 text-sm text-[#f4eee8] hover:bg-[#5a1f1f]"
              >
                Check In
              </button>
            </form>
          )}
          {showCancel && (
            <form action={cancelBookingAction}>
              <input type="hidden" name="bookingId" value={booking.bookingId} />
              <button
                type="submit"
                data-testid={`dashboard-cancel-${booking.bookingId}`}
                disabled={!booking.canCancel}
                aria-describedby={
                  !booking.canCancel && booking.cancellationBlockedReason
                    ? `cancel-reason-${booking.bookingId}`
                    : undefined
                }
                className="rounded-md border border-[#7b2d2d] px-3 py-1 text-sm text-[#7b2d2d] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel booking
              </button>
            </form>
          )}
        </div>
        {!booking.canCheckIn && !booking.isCheckedIn && booking.checkInBlockedReason && (
          <p className="text-xs text-[#8a5959]">
            {booking.checkInBlockedReason}
          </p>
        )}
        {showCancel && !booking.canCancel && booking.cancellationBlockedReason && (
          <p id={`cancel-reason-${booking.bookingId}`} className="text-xs text-[#8a5959]">
            {booking.cancellationBlockedReason}
          </p>
        )}
      </div>
    </li>
  );
}

async function cancelBookingAction(formData: FormData) {
  "use server";

  return Sentry.withServerActionInstrumentation(
    "booking.cancelBookingAction",
    { recordResponse: false },
    async () => {
      await assertSameOriginServerAction();

      const session = await requireAuth();
      const bookingId = String(formData.get("bookingId") ?? "");
      if (!bookingId) {
        redirect("/dashboard/bookings?error=invalid_request");
      }

      try {
        await cancelClientBooking({
          bookingId,
          clientId: session.user.id,
        });
      } catch (error) {
        Sentry.captureException(error);
        if (error instanceof DashboardServiceError) {
          if (error.code === "BOOKING_TOO_LATE_TO_CANCEL") {
            redirect("/dashboard/bookings?error=too_late");
          }

          if (
            error.code === "BOOKING_NOT_FOUND"
            || error.code === "BOOKING_NOT_OWNED"
            || error.code === "BOOKING_NOT_CANCELLABLE"
          ) {
            redirect("/dashboard/bookings?error=not_cancellable");
          }
        }

        redirect("/dashboard/bookings?error=cancel_failed");
      }

      revalidatePath("/dashboard");
      revalidatePath("/dashboard/bookings");
      redirect("/dashboard/bookings?cancelled=1");
    },
  );
}

async function checkInBookingAction(formData: FormData) {
  "use server";

  return Sentry.withServerActionInstrumentation(
    "booking.checkInBookingAction",
    { recordResponse: false },
    async () => {
      await assertSameOriginServerAction();

      const session = await requireAuth();
      const bookingId = String(formData.get("bookingId") ?? "");
      if (!bookingId) {
        redirect("/dashboard/bookings?error=invalid_request");
      }

      try {
        await checkInBooking({
          bookingId,
          clientId: session.user.id,
          source: AttendanceSource.DASHBOARD,
        });
      } catch (error) {
        Sentry.captureException(error);
        if (error instanceof Error) {
          if (error.message === "CHECKIN_WINDOW_CLOSED") {
            redirect("/dashboard/bookings?error=checkin_window_closed");
          }
          if (error.message === "PRIVATE_CLASSES_NOT_ELIGIBLE_FOR_CHECKIN") {
            redirect("/dashboard/bookings?error=checkin_private");
          }
          if (
            error.message === "BOOKING_NOT_FOUND"
            || error.message === "BOOKING_NOT_OWNED"
            || error.message === "BOOKING_NOT_CONFIRMED"
            || error.message === "SESSION_NOT_SCHEDULED"
          ) {
            redirect("/dashboard/bookings?error=checkin_not_allowed");
          }
          if (error.message === "BOOKING_ALREADY_FINALIZED_FOR_ATTENDANCE") {
            redirect("/dashboard/bookings?error=checkin_finalized");
          }
        }
        redirect("/dashboard/bookings?error=checkin_failed");
      }

      revalidatePath("/dashboard");
      revalidatePath("/dashboard/bookings");
      redirect("/dashboard/bookings?checked_in=1");
    },
  );
}

function getMessage(params: { cancelled?: string; checked_in?: string; error?: string }) {
  if (params.cancelled === "1") {
    return { type: "success" as const, text: "Booking cancelled." };
  }

  if (params.checked_in === "1") {
    return { type: "success" as const, text: "Successfully checked in!" };
  }

  if (params.error === "too_late") {
    return {
      type: "error" as const,
      text: "You can no longer cancel this booking because the cancellation window has passed.",
    };
  }

  if (params.error === "not_cancellable") {
    return { type: "error" as const, text: "This booking cannot be cancelled." };
  }

  if (params.error === "checkin_failed") {
    return { type: "error" as const, text: "Check-in failed. Please try again." };
  }

  if (params.error === "checkin_window_closed") {
    return { type: "error" as const, text: "Check-in is only available during the check-in window." };
  }

  if (params.error === "checkin_private") {
    return { type: "error" as const, text: "Private classes are not eligible for self check-in." };
  }

  if (params.error === "checkin_not_allowed") {
    return { type: "error" as const, text: "This booking cannot be checked in." };
  }

  if (params.error === "checkin_finalized") {
    return { type: "error" as const, text: "Attendance has already been finalized for this booking." };
  }

  if (params.error) {
    return { type: "error" as const, text: "Could not cancel booking." };
  }

  return null;
}

export default async function DashboardBookingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAuth();
  const [data, params] = await Promise.all([
    getDashboardBookingsData(session.user.id),
    searchParams,
  ]);
  const message = getMessage(params);

  return (
    <section>
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">My Bookings</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Track upcoming, past, and cancelled sessions.</p>

      {message ? (
        <p
          className={`mb-4 text-sm ${message.type === "error" ? "text-[#7b2d2d]" : "text-[#2f6b35]"}`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-[#6f2b2b]">Upcoming</h2>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-[#5f4040]">No upcoming bookings.</p>
          ) : (
            <ul className="space-y-2">{data.upcoming.map((booking) => renderBookingCard(booking, true))}</ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[#6f2b2b]">Past</h2>
          {data.past.length === 0 ? (
            <p className="text-sm text-[#5f4040]">No past bookings.</p>
          ) : (
            <ul className="space-y-2">{data.past.map((booking) => renderBookingCard(booking, false))}</ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-[#6f2b2b]">Cancelled</h2>
          {data.cancelled.length === 0 ? (
            <p className="text-sm text-[#5f4040]">No cancelled bookings.</p>
          ) : (
            <ul className="space-y-2">
              {data.cancelled.map((booking) => renderBookingCard(booking, false))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
