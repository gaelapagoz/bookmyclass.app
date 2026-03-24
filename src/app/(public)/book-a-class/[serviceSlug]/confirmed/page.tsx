import Link from "next/link";
import { BookingPaymentSelection, BookingStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { getBookingConfirmationView } from "@/lib/public-booking/booking-confirmation-view";

export default async function BookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceSlug: string }>;
  searchParams: Promise<{ bookingId?: string }>;
}) {
  const session = await requireAuth();
  const { serviceSlug } = await params;
  const { bookingId } = await searchParams;

  const booking = bookingId
    ? await getBookingConfirmationView({
        bookingId,
        userId: session.user.id,
      })
    : null;

  const isConfirmedWithPlan =
    booking?.status === BookingStatus.CONFIRMED &&
    booking?.paymentSelection === BookingPaymentSelection.EXISTING_PLAN;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">
        {isConfirmedWithPlan ? "Booking Confirmed" : "Confirmation Pending"}
      </h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        {isConfirmedWithPlan
          ? "Your class has been booked using your existing plan."
          : "We could not verify a confirmed plan booking yet. Please check your dashboard bookings."}
      </p>
      {booking ? (
        <div className="mt-5 rounded-xl border border-[#d8cec6] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Booking Summary</h2>
          <dl className="mt-3 space-y-2 text-sm text-[#5f4040]">
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Class</dt>
              <dd>{booking.className}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Date</dt>
              <dd>{booking.date}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Time</dt>
              <dd>
                {booking.startTime} - {booking.endTime}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        <Link
          href={`/book-a-class/${booking?.serviceSlug ?? serviceSlug}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to service
        </Link>
        <Link
          href="/dashboard/bookings"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Go to My Bookings
        </Link>
      </div>
    </section>
  );
}
