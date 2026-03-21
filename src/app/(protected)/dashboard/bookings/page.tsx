import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  cancelClientBooking,
  DashboardBookingItem,
  DashboardServiceError,
  getDashboardBookingsData,
} from "@/lib/dashboard/dashboard-service";

type SearchParams = Promise<{
  error?: string;
  cancelled?: string;
}>;

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function renderBookingCard(booking: DashboardBookingItem, showCancel: boolean) {
  return (
    <li key={booking.bookingId} className="rounded-md border border-[#ebe1d8] bg-white p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-[#6f2b2b]">{booking.serviceTitle}</p>
        <p className="text-xs uppercase tracking-wide text-[#8a5959]">{booking.status}</p>
      </div>
      <p className="mt-1 text-sm text-[#5f4040]">{formatDateTime(booking.startsAt)}</p>
      {booking.location ? <p className="text-sm text-[#5f4040]">{booking.location}</p> : null}
      {showCancel ? (
        <form action={cancelBookingAction} className="mt-3">
          <input type="hidden" name="bookingId" value={booking.bookingId} />
          <button
            type="submit"
            disabled={!booking.canCancel}
            className="rounded-md border border-[#7b2d2d] px-3 py-1 text-sm text-[#7b2d2d] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel booking
          </button>
          {!booking.canCancel ? (
            <p className="mt-1 text-xs text-[#8a5959]">
              Cancellation unavailable (past cutoff, already cancelled, or session not active).
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

async function cancelBookingAction(formData: FormData) {
  "use server";

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
    if (error instanceof DashboardServiceError) {
      if (error.code === "BOOKING_TOO_LATE_TO_CANCEL") {
        redirect("/dashboard/bookings?error=too_late");
      }

      if (
        error.code === "BOOKING_NOT_FOUND" ||
        error.code === "BOOKING_NOT_OWNED" ||
        error.code === "BOOKING_NOT_CANCELLABLE"
      ) {
        redirect("/dashboard/bookings?error=not_cancellable");
      }
    }

    redirect("/dashboard/bookings?error=cancel_failed");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/bookings");
  redirect("/dashboard/bookings?cancelled=1");
}

function getMessage(params: { cancelled?: string; error?: string }) {
  if (params.cancelled === "1") {
    return { type: "success" as const, text: "Booking cancelled." };
  }

  if (params.error === "too_late") {
    return { type: "error" as const, text: "You can no longer cancel this booking within 24 hours." };
  }

  if (params.error === "not_cancellable") {
    return { type: "error" as const, text: "This booking cannot be cancelled." };
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
