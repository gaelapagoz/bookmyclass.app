import Link from "next/link";
import { BookingPaymentSelection, BookingStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db";

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

  const booking =
    bookingId
      ? await prisma.booking.findFirst({
          where: { id: bookingId, clientId: session.user.id },
          select: {
            id: true,
            status: true,
            paymentSelection: true,
          },
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
      <p className="mt-3 text-sm text-[#5f4040]">Booking ID: {bookingId ?? "Unavailable"}</p>

      <div className="mt-6 flex items-center gap-4">
        <Link
          href={`/book-a-class/${serviceSlug}`}
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
