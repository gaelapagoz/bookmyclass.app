import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getKioskSessionContext } from "@/lib/kiosk/kiosk-service";
import { getBookingSelfCheckInEligibility } from "@/lib/attendance/attendance-service";
import { requireStaffSession } from "@/lib/auth/require-auth";
import { CheckInButton } from "./check-in-button";

interface KioskSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function KioskSessionPage({ params }: KioskSessionPageProps) {
  await requireStaffSession({
    callbackUrl: `/kiosk/${(await params).sessionId}`,
    unauthorizedPath: "/sign-in",
  });

  const { sessionId } = await params;

  let sessionContext;
  try {
    sessionContext = await getKioskSessionContext(sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_NOT_FOUND") {
      notFound();
    }
    if (error instanceof Error && error.message === "PRIVATE_CLASSES_NOT_ELIGIBLE_FOR_KIOSK") {
      redirect("/kiosk");
    }
    throw error;
  }

  const { session, bookings: allBookings } = sessionContext;
  const bookings = allBookings.filter((booking) => booking.client !== null);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">{session.title}</h1>
            <p className="mt-1 text-lg text-[#4b5a72]">{session.className}</p>
            <div className="mt-3 space-y-1 text-sm text-[#4b5a72]">
              <p>{session.dateTimeLabel}</p>
              <p>{bookings.length} confirmed bookings</p>
            </div>
          </div>
          <Link
            href="/kiosk"
            className="rounded-md border border-[#d3dbe5] bg-white px-4 py-2 text-sm font-medium text-[#4b5a72] transition-colors hover:bg-[#f9f7f4]"
          >
            Back to Sessions
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-[#1f2735]">Confirmed Bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-[#4b5a72]">No confirmed bookings for this session.</p>
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking as { id: string; clientId: string; client: { name: string; email: string } }}
                sessionId={sessionId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface BookingRowProps {
  booking: {
    id: string;
    clientId: string;
    client: { name: string; email: string };
  };
  sessionId: string;
}

async function BookingRow({ booking, sessionId }: BookingRowProps) {
  const eligibility = await getBookingSelfCheckInEligibility(booking.id, booking.clientId);

  const isCheckedIn = eligibility.attendanceStatus === "CHECKED_IN";
  const canCheckIn =
    eligibility.isConfirmedBooking
    && eligibility.isSessionScheduled
    && !eligibility.isPrivateClass
    && eligibility.isWithinWindow
    && !isCheckedIn;

  const blockedReason = isCheckedIn
    ? "Already checked in"
    : eligibility.isPrivateClass
      ? "Private classes are not eligible for self check-in."
      : !eligibility.isConfirmedBooking
        ? "Booking is not confirmed."
        : !eligibility.isSessionScheduled
          ? "Session is not scheduled."
          : eligibility.isBeforeWindow
            ? `Check-in opens at ${eligibility.window.opensAtLabel}.`
            : eligibility.isAfterWindow
              ? "Check-in window has closed."
              : "Outside check-in window.";

  return (
    <div
      className="flex items-center justify-between rounded-lg border border-[#d3dbe5] p-4"
      data-testid={`kiosk-booking-${booking.id}`}
    >
      <div>
        <p className="font-medium text-[#1f2735]">{booking.client.name}</p>
        <p className="text-sm text-[#4b5a72]">{booking.client.email}</p>
        {isCheckedIn && (
          <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
            Checked In
          </span>
        )}
      </div>
      <div className="flex items-center space-x-3">
        {!canCheckIn && <span className="text-sm text-[#7b7b7b]">{blockedReason}</span>}
        {canCheckIn && <CheckInButton bookingId={booking.id} sessionId={sessionId} />}
      </div>
    </div>
  );
}
