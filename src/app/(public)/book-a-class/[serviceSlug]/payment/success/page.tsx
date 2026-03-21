import Link from "next/link";
import { BookingStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db";
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

  const booking =
    bookingId
      ? await prisma.booking.findFirst({
          where: { id: bookingId, clientId: session.user.id },
          select: {
            id: true,
            status: true,
            payments: {
              where: { provider: PaymentProvider.STRIPE },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true, failureReason: true, providerReference: true },
            },
          },
        })
      : null;

  const latestPayment = booking?.payments[0] ?? null;
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
      <p className="mt-3 text-sm text-[#5f4040]">Booking ID: {bookingId ?? "Unavailable"}</p>
      {session_id ? <p className="mt-1 text-xs text-[#7f5a5a]">Stripe session: {session_id}</p> : null}
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
          href={`/book-a-class/${serviceSlug}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to service
        </Link>
      </div>
    </section>
  );
}
