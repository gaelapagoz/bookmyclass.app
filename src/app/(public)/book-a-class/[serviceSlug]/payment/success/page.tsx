import Link from "next/link";
import { BookingStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db";
import { getBookingConfirmationView } from "@/lib/public-booking/booking-confirmation-view";
import { reconcileCheckoutSessionAfterReturn } from "@/lib/public-booking/stripe-webhook-service";

export default async function BookingPaymentSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceSlug: string }>;
  searchParams: Promise<{ bookingId?: string; session_id?: string }>;
}) {
  const session = await requireAuth();
  const { serviceSlug } = await params;
  const { bookingId, session_id } = await searchParams;

  if (bookingId && session_id) {
    try {
      await reconcileCheckoutSessionAfterReturn({
        checkoutSessionId: session_id,
        bookingId,
        userId: session.user.id,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[payment/success] manual reconciliation failed", {
          bookingId,
          sessionId: session_id,
          error,
        });
      }
    }
  }

  const booking = bookingId
    ? await getBookingConfirmationView({
        bookingId,
        userId: session.user.id,
      })
    : null;

  const latestPayment = bookingId
    ? await prisma.payment.findFirst({
        where: {
          bookingId,
          provider: PaymentProvider.STRIPE,
          booking: {
            clientId: session.user.id,
          },
        },
        orderBy: { createdAt: "desc" },
        select: { status: true, failureReason: true },
      })
    : null;

  const looksConfirmed =
    booking?.status === BookingStatus.CONFIRMED &&
    latestPayment?.status === PaymentStatus.SUCCEEDED;
  const looksFailed = latestPayment?.status === PaymentStatus.FAILED;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">
        {looksConfirmed ? "Payment Confirmed" : looksFailed ? "Payment Failed" : "Payment Processing"}
      </h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        {looksConfirmed
          ? "Payment succeeded and your booking is confirmed."
          : looksFailed
            ? "Payment failed. Your booking was not confirmed."
            : "Stripe returned successfully, but confirmation is still processing. Please refresh in a few seconds."}
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
              <dt className="font-medium">Date &amp; Time</dt>
              <dd>{booking.dateTime}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Teacher</dt>
              <dd>{booking.teacherName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium">Location</dt>
              <dd>{booking.locationName}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      {looksFailed && latestPayment?.failureReason ? (
        <p className="mt-2 text-sm text-[#7b2d2d]">{latestPayment.failureReason}</p>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        <Link
          href={`/book-a-class/${serviceSlug}/payment?bookingId=${bookingId ?? ""}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          {looksFailed ? "Retry payment" : "Back to payment status"}
        </Link>
        <Link
          href={`/book-a-class/${booking?.serviceSlug ?? serviceSlug}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to service
        </Link>
      </div>
    </section>
  );
}
